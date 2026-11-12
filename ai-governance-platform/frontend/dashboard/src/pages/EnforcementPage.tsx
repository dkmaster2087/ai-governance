import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AwsLock, AwsSettings, Blocked, createFeed, deleteFindings, Enforcement, Feed, FeedCategory, feedContent, FeedFormat, generateAws,
  exportApiList, getEnforcement, getLockKitApis, NewFeedUrls, PathState, PathStatus, previewFeed, revokeFeed, rotateFeed, saveAws, setPathState, slimFindings, uploadFindings,
} from '../lib/enforcement-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Note, Panel, Segmented, SectionLabel, Switch, formatCount } from '../components/kit/primitives';
import { KitLanguage, lockKit, SCAN_SCRIPTS } from '../lib/lock-kit';

const Beta = () => <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-line-subtle text-ink-soft">Beta</span>;
const input = 'min-h-[42px] px-3 border border-line-strong rounded-lg bg-white w-full';
const code = 'block bg-canvas border border-line-subtle rounded-lg px-3.5 py-3 font-mono text-[12.5px] [overflow-wrap:anywhere] whitespace-pre-wrap max-h-[320px] overflow-auto';

const when = (iso?: string) => iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const day = (d?: string) => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard unavailable */ } }}>{done ? 'Copied' : label}</Button>;
}

function download(name: string, body: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

function BlockedTable({ rows, aws }: { rows: Blocked[]; aws?: boolean }) {
  if (rows.length === 0) return <p className="m-0 text-sm text-ink-muted">Nobody in the findings file.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead><tr className="text-left text-ink-muted text-xs"><th className="py-2 pr-3 font-medium">Caller</th><th className="py-2 pr-3 font-medium">Services</th><th className="py-2 font-medium text-right">Calls</th></tr></thead>
        <tbody>
          {rows.slice(0, 20).map((r) => (
            <tr key={r.who} className="border-t border-line-subtle align-top">
              <td className="py-2 pr-3"><code className="font-mono text-[12.5px] [overflow-wrap:anywhere]">{r.who}</code>{aws && r.identityKnown === false && <div className="text-xs text-ink-muted">Seen by address only: the lock applies to whichever role it uses.</div>}</td>
              <td className="py-2 pr-3">{r.services.join(', ')}</td>
              <td className="py-2 text-right font-mono">{formatCount(r.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 20 && <p className="m-0 mt-2 text-xs text-ink-muted">And {rows.length - 20} more.</p>}
    </div>
  );
}

const readText = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsText(file);
});

// ── Paths ───────────────────────────────────────────────────────────────────────────────────────────────────

const pct = (x: number) => `${Math.round(x * 100)}%`;
const STATES: Array<{ value: PathState; label: string }> = [
  { value: 'open', label: 'Open' }, { value: 'previewing', label: 'Previewing' }, { value: 'locked', label: 'Locked' },
];

function PathRow({ p }: { p: PathStatus }) {
  const qc = useQueryClient();
  const set = useMutation({ mutationFn: (state: PathState) => setPathState(p.id, state), onSuccess: () => qc.invalidateQueries({ queryKey: ['enforcement'] }) });
  const m = p.measured;
  return (
    <Panel as="article" aria-label={p.title} className={clsx('px-6 py-5 flex flex-col gap-3', p.warning && 'border-stop')}>
      <div className="flex flex-wrap justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 text-lg font-semibold">{p.title}</h3>
          <p className="m-0 text-sm text-ink-muted">Lock: {p.lock}{p.anchor && <> · <a href={`#${p.anchor}`} className="font-semibold text-ink">set it up</a></>}</p>
        </div>
        {p.coming
          ? <span className="self-start text-xs font-semibold px-2 py-0.5 rounded-full bg-line-subtle text-ink-soft">Coming</span>
          : <div className="max-w-full overflow-x-auto"><Segmented label={`State of ${p.title}`} options={STATES} value={p.state} onChange={(v) => set.mutate(v)} /></div>}
      </div>
      {set.isError && <p role="alert" className="m-0 text-sm text-stop">{errorMessage(set.error)}</p>}
      {p.warning && <p role="alert" className="m-0 text-sm font-semibold text-stop">{p.warning}</p>}
      {p.coming && <p className="m-0 text-sm text-ink-muted">Not built yet. This path stays open until it is.</p>}
      {p.measuredElsewhere && <p className="m-0 text-sm text-ink-muted">{p.measuredElsewhere} <Link to="/shadow-ai" className="font-semibold text-ink">Shadow AI</Link></p>}
      {!p.coming && !p.measuredElsewhere && !m && !p.laptops && <p className="m-0 text-sm text-ink-muted">{p.id === 'in_laptop_mcp' ? 'Not scanned yet. Run the laptop scan, then upload the findings below.' : 'Not measured yet. Upload a findings file below.'}</p>}
      {p.laptops && (
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
          <div className="sm:w-[150px] shrink-0">
            <div className={clsx('text-[34px] leading-none font-bold tracking-[-0.02em]', p.laptops.devicesWithServers > 0 && 'text-stop')}>{formatCount(p.laptops.devicesWithServers)}</div>
            <div className="text-xs text-ink-muted mt-1">of {formatCount(p.laptops.scannedDevices)} {p.laptops.scannedDevices === 1 ? 'laptop' : 'laptops'} with MCP servers set up by hand</div>
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-1.5 text-sm">
            <p className="m-0 text-ink-muted">Scan in findings to {day(p.laptops.to)}; {formatCount(p.laptops.people)} {p.laptops.people === 1 ? 'person' : 'people'}.</p>
            {p.laptops.servers.length > 0 && <p className="m-0"><strong>Most common:</strong> {p.laptops.servers.slice(0, 4).map((x) => `${x.what}${x.company ? ' (company system)' : ''}`).join(', ')}.</p>}
          </div>
        </div>
      )}
      {m && (
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
          <div className="sm:w-[150px] shrink-0">
            <div className={clsx('text-[34px] leading-none font-bold tracking-[-0.02em]', !m.gatewaySeen && 'text-stop')}>{m.share === null ? '–' : pct(m.share)}</div>
            <div className="text-xs text-ink-muted mt-1">through Probaline</div>
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-1.5 text-sm">
            <p className="m-0 text-ink-muted">{formatCount(m.through)} of {formatCount(m.through + m.direct)} in {m.measuredBy ?? 'the collector’s logs'}, findings to {day(m.to)}.</p>
            {!m.gatewaySeen && <p className="m-0 text-ink-muted">The gateway wasn’t seen in these logs: name it with <code className="font-mono">--gateway</code> when you run the collector.</p>}
            {p.trend.length > 1 && <p className="m-0">Trend: {p.trend.map((t) => `${day(t.to)} ${pct(t.share)}`).join(' → ')}</p>}
            {m.stillDirectCount === 0
              ? <p className="m-0 font-semibold">Nothing goes around Probaline on this path.</p>
              : <p className="m-0"><strong>Still direct:</strong> {m.stillDirect.slice(0, 3).map((c) => c.who).join(', ')}{m.stillDirectCount > 3 ? ` and ${formatCount(m.stillDirectCount - 3)} more` : ''}.</p>}
          </div>
        </div>
      )}
    </Panel>
  );
}

// ── Findings files ──────────────────────────────────────────────────────────────────────────────────────────

function FindingsFiles({ data }: { data: Enforcement }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['enforcement'] });
  const upload = useMutation({ mutationFn: ({ f, name }: { f: ReturnType<typeof slimFindings>; name: string }) => uploadFindings(f, name), onSuccess: () => { setError(null); refresh(); }, onError: (e) => setError(errorMessage(e)) });
  const remove = useMutation({ mutationFn: deleteFindings, onSuccess: refresh });
  return (
    <Panel aria-label="Findings files" className="px-6 py-5 flex flex-col gap-3">
      <SectionLabel>Findings files</SectionLabel>
      <p className="m-0 text-sm text-ink-muted max-w-[760px]">
        Upload <code className="font-mono">reports/findings-&lt;day&gt;.json</code> from the collector after each run. Probaline keeps the share per path, the services in use and who still goes direct (no log lines; people stay as codes) for 400 days, for the trend above and the previews below.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center min-h-[42px] px-4 rounded-lg bg-ink text-white font-semibold text-sm cursor-pointer">
          {upload.isPending ? 'Uploading…' : 'Upload findings file'}
          <input type="file" accept="application/json,.json" className="sr-only" aria-label="Findings file" onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try { upload.mutate({ f: slimFindings(JSON.parse(await readText(file))), name: file.name }); } catch (err) { setError((err as Error).message.startsWith('This') ? (err as Error).message : 'That file isn’t valid JSON.'); }
          }} />
        </label>
      </div>
      {error && <p role="alert" className="m-0 text-sm text-stop">{error}</p>}
      {data.findings.length === 0
        ? <p className="m-0 text-sm text-ink-muted">None yet.</p>
        : (
          <ul className="m-0 p-0 list-none flex flex-col">
            {data.findings.slice(0, 8).map((f, i) => (
              <li key={f.findingsId} className="flex flex-wrap justify-between items-center gap-2 py-2 border-t border-line-subtle text-sm">
                <span><strong>{f.from ? `${day(f.from)} to ` : 'To '}{day(f.to)}</strong>{i === 0 && <span className="text-ink-muted"> · used for previews</span>}<span className="block text-xs text-ink-muted">{f.fileName ?? 'findings'} · {f.services} services · catalog {f.catalogVersion ?? 'unknown'} · uploaded {when(f.uploadedAt)}</span></span>
                <button type="button" className="text-sm underline" onClick={() => remove.mutate(f.findingsId)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      {data.findings.length > 8 && <p className="m-0 text-xs text-ink-muted">And {data.findings.length - 8} older files.</p>}
    </Panel>
  );
}

// ── Feeds ───────────────────────────────────────────────────────────────────────────────────────────────────

function FeedUrls({ data, created, onDone }: { data: Enforcement; created: NewFeedUrls; onDone: () => void }) {
  return (
    <Panel aria-label="Feed addresses" className="px-6 py-5 border-2 border-ink flex flex-col gap-4">
      <div>
        <p className="m-0 font-semibold">Copy the feed address now. It won’t be shown again.</p>
        <p className="m-0 mt-1 text-sm text-ink-muted">The address is the password: anyone with it can read the list (only public domain names). Rotate it if it leaks.</p>
      </div>
      {data.formats.map((f) => (
        <div key={f.id} className="flex flex-col gap-1.5">
          <p className="m-0 text-sm"><strong>{f.label}</strong> <span className="text-ink-muted">· {f.products}</span></p>
          <div className="flex gap-2 flex-col sm:flex-row sm:items-start">
            <code className={`${code} w-full sm:flex-1 sm:min-w-0`}>{created.urls[f.id]}</code>
            <CopyButton text={created.urls[f.id]} />
          </div>
          <p className="m-0 text-sm text-ink-soft">{f.rule}</p>
        </div>
      ))}
      <div><Button variant="secondary" onClick={onDone}>I’ve saved it</Button></div>
    </Panel>
  );
}

function FeedForm({ data, latestTo, onCreated, onCancel }: { data: Enforcement; latestTo?: string; onCreated: (c: NewFeedUrls) => void; onCancel: () => void }) {
  const [name, setName] = useState('Firewalls');
  const [cats, setCats] = useState<FeedCategory[]>(data.defaultCategories);
  const preview = useQuery({ queryKey: ['feed-preview', cats, latestTo], queryFn: () => previewFeed(cats), enabled: cats.length > 0 });
  const create = useMutation({ mutationFn: () => createFeed({ name, categories: cats }), onSuccess: onCreated });
  const toggle = (c: FeedCategory) => setCats((cur) => cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]);
  const blocked = preview.data?.wouldBeBlocked;
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 max-w-[420px]"><span className="text-sm font-semibold">Name</span>
        <input className={input} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </label>
      <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
        <legend className="text-sm font-semibold mb-1.5">Block these kinds of AI service</legend>
        {data.categories.map((c) => (
          <label key={c.id} className="flex gap-3 items-start">
            <input type="checkbox" className="mt-1 w-4 h-4" checked={cats.includes(c.id)} onChange={() => toggle(c.id)} />
            <span><span className="font-semibold">{c.label}</span><span className="block text-sm text-ink-muted">{c.hint}</span></span>
          </label>
        ))}
      </fieldset>
      {data.approvedTools.length > 0 && <p className="m-0 text-sm text-ink-muted">Tools allowed on the <Link to="/shadow-ai" className="font-semibold text-ink">Shadow AI</Link> page are left out.</p>}
      {preview.data && (
        <div className="rounded-lg bg-canvas border border-line-subtle px-4 py-3 text-sm flex flex-col gap-2">
          <p className="m-0"><strong>{formatCount(preview.data.domains)} domains</strong>, such as {preview.data.sample.slice(0, 5).join(', ')}.</p>
          {blocked && (
            <>
              <p className="m-0">From findings to {day(preview.data.findingsTo)}, this would stop: {blocked.services.length === 0 ? 'nothing in use.' : blocked.services.map((s) => `${s.name} (${formatCount(s.people + s.machines)} users or devices)`).join(', ')}</p>
              {blocked.apps.length > 0 && <><p className="m-0 font-semibold">Apps calling model APIs directly that would lose access until routed through Probaline:</p><BlockedTable rows={blocked.apps} /></>}
            </>
          )}
          {!latestTo && <p className="m-0 text-ink-muted">Upload a findings file above to see who this would stop.</p>}
        </div>
      )}
      {create.isError && <p role="alert" className="m-0 text-sm text-stop">{errorMessage(create.error)}</p>}
      <div className="flex gap-2 flex-wrap">
        <Button disabled={!name.trim() || cats.length === 0 || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create feed'}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function FeedCard({ f, data, onUrls }: { f: Feed; data: Enforcement; onUrls: (c: NewFeedUrls) => void }) {
  const qc = useQueryClient();
  const [showing, setShowing] = useState<FeedFormat | null>(null);
  const [confirm, setConfirm] = useState<'rotate' | 'revoke' | null>(null);
  const content = useQuery({ queryKey: ['feed-content', f.feedId, showing], queryFn: () => feedContent(f.feedId, showing!), enabled: !!showing });
  const rotate = useMutation({ mutationFn: () => rotateFeed(f.feedId), onSuccess: (r) => { setConfirm(null); onUrls(r); qc.invalidateQueries({ queryKey: ['enforcement'] }); } });
  const revoke = useMutation({ mutationFn: () => revokeFeed(f.feedId), onSuccess: () => qc.invalidateQueries({ queryKey: ['enforcement'] }) });
  const labels = Object.fromEntries(data.categories.map((c) => [c.id, c.label]));
  return (
    <Panel as="article" aria-label={f.name} className="px-6 py-5 flex flex-col gap-3">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h3 className="m-0 text-lg font-semibold">{f.name}</h3>
          <p className="m-0 text-sm text-ink-muted">{f.categories.map((c) => labels[c] ?? c).join(', ')} · {formatCount(f.domains)} domains · address ends …{f.tokenHint}</p>
        </div>
        <p className="m-0 text-sm text-right">
          {f.lastFetchedAt
            ? <>Last fetched {when(f.lastFetchedAt)}<br /><span className="text-ink-muted">by {f.lastFetchedFrom}{f.lastFetchedAgent ? ` (${f.lastFetchedAgent})` : ''} · {formatCount(f.fetchCount)} {f.fetchCount === 1 ? 'fetch' : 'fetches'}</span></>
            : <span className="text-stop font-semibold">Not fetched yet</span>}
        </p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button variant="secondary" onClick={() => setShowing(showing ? null : 'domains')}>{showing ? 'Hide contents' : 'Show contents'}</Button>
        <Button variant="secondary" onClick={() => setConfirm('rotate')}>New address</Button>
        <Button variant="secondary" onClick={() => setConfirm('revoke')}>Revoke</Button>
      </div>
      {confirm && (
        <div role="alertdialog" aria-label={confirm === 'rotate' ? 'Confirm new address' : 'Confirm revoke'} className="rounded-lg border border-line-strong px-4 py-3 flex flex-col gap-2">
          <p className="m-0 text-sm">{confirm === 'rotate'
            ? 'The current address stops working at once. Firewalls keep their last copy until you give them the new address.'
            : 'The address stops working at once and the feed is deleted. Firewalls keep their last copy; remove the list from them too.'}</p>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => (confirm === 'rotate' ? rotate.mutate() : revoke.mutate())}>{confirm === 'rotate' ? 'Make a new address' : 'Revoke feed'}</Button>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
          {(rotate.isError || revoke.isError) && <p role="alert" className="m-0 text-sm text-stop">{errorMessage(rotate.error ?? revoke.error)}</p>}
        </div>
      )}
      {showing && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 flex-wrap text-sm">
            {data.formats.map((x) => <button key={x.id} type="button" aria-pressed={showing === x.id} className={showing === x.id ? 'font-semibold underline' : 'text-ink-muted'} onClick={() => setShowing(x.id)}>{x.label}</button>)}
          </div>
          <code className={code}>{content.isLoading ? 'Loading…' : content.data}</code>
        </div>
      )}
    </Panel>
  );
}

// ── AWS ─────────────────────────────────────────────────────────────────────────────────────────────────────

// ── Incoming: lock your APIs ────────────────────────────────────────────────────────────────────────────────

const KIT_TABS: Array<{ value: KitLanguage; label: string }> = [
  { value: 'node', label: 'Node' }, { value: 'python', label: 'Python' }, { value: 'lambda', label: 'Lambda' }, { value: 'go', label: 'Go' }, { value: 'java', label: 'Java' },
];

function LockApisPanel({ egressIps }: { egressIps: string[] }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['lock-kit-apis'], queryFn: getLockKitApis });
  const [apiId, setApiId] = useState<string | null>(null);
  const [lang, setLang] = useState<KitLanguage>('node');
  const [reportOnly, setReportOnly] = useState(true);
  const api = data?.apis.find((a) => a.apiId === apiId) ?? data?.apis[0];
  const kit = api && data ? lockKit(data.issuer, api.audience, reportOnly).find((k) => k.id === lang)! : null;
  return (
    <Panel aria-label="Lock your APIs" className="px-6 py-5 flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-3"><h2 className="m-0 text-xl font-semibold">Your APIs: only calls that came through Probaline</h2><Beta /></div>
        <p className="m-0 mt-1 text-sm text-ink-muted max-w-[760px]">
          Every call Probaline makes to an API behind an MCP server carries <code className="font-mono">X-Probaline-Identity</code>: a five-minute token, signed by the gateway, saying who asked and through which tool. Add the check below to the API and anything that didn’t come through Probaline is refused.
        </p>
      </div>
      <ol className="m-0 pl-5 text-sm flex flex-col gap-1 list-decimal">
        <li>Add the check with report-only on: calls without a valid token are logged, not refused.</li>
        <li>Watch that log until only Probaline’s calls arrive.</li>
        <li>Turn report-only off, deploy, and mark “Agents calling your APIs directly” Locked above.</li>
      </ol>
      {isError && <p role="alert" className="m-0 text-sm text-stop">Couldn’t load your APIs.</p>}
      {isLoading && <p className="m-0 text-sm text-ink-muted">Loading…</p>}
      {data && data.apis.length === 0 && <Note title="No APIs behind MCP servers yet."><>Add one on <Link to="/mcp" className="font-semibold text-ink">MCP servers</Link>; its lock appears here.</></Note>}
      {data && api && kit && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">API</span>
              <select className={input} value={api.apiId} onChange={(e) => setApiId(e.target.value)}>
                {data.apis.map((a) => <option key={a.apiId} value={a.apiId}>{a.serverName} · {a.name}</option>)}
              </select>
            </label>
            <div className="flex items-end gap-3 pb-2"><Switch checked={reportOnly} onChange={setReportOnly} label="Report only" /><span className="text-sm font-semibold">Report only (log, don’t refuse)</span></div>
          </div>
          <dl className="m-0 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="text-ink-muted">Issuer</dt><dd className="m-0 font-mono text-[13px] [overflow-wrap:anywhere]">{data.issuer}</dd>
            <dt className="text-ink-muted">Audience</dt><dd className="m-0 font-mono text-[13px] [overflow-wrap:anywhere]">{api.audience}</dd>
            <dt className="text-ink-muted">Keys</dt><dd className="m-0 font-mono text-[13px] [overflow-wrap:anywhere]">{data.jwksUrl}</dd>
          </dl>
          <div className="max-w-full overflow-x-auto"><Segmented label="Language" options={KIT_TABS} value={lang} onChange={setLang} /></div>
          <div className="flex flex-col gap-2">
            <p className="m-0 text-sm"><strong>{kit.label}</strong> {kit.tested ? <span className="text-ink-muted">· tested against tokens the gateway signs</span> : <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-line-subtle text-ink-soft">Not yet tested</span>}</p>
            <p className="m-0 text-sm text-ink-soft">{kit.setup}</p>
            <code className={code}>{kit.usage}</code>
            <div className="flex gap-2 flex-wrap">
              <CopyButton text={kit.usage} label="Copy" />
              {kit.files.map((f) => <Button key={f.name} variant="secondary" onClick={() => download(f.name, f.body, 'text/plain')}>Download {f.name}</Button>)}
            </div>
          </div>
          <div className="text-sm flex flex-col gap-2">
            <p className="m-0 font-semibold">Check it with your access logs</p>
            <p className="m-0 text-ink-muted">Give the collector this list with the APIs’ access logs (AWS load balancer, API Gateway, nginx or Envoy). The report and the row above then show the share of calls that came through Probaline and who called directly.</p>
            <div><Button variant="secondary" onClick={async () => download(`probaline-apis-${new Date().toISOString().slice(0, 10)}.json`, await exportApiList())}>Download API list for the collector</Button></div>
          </div>
          <div className="text-sm flex flex-col gap-1">
            <p className="m-0 font-semibold">Or, without code changes: allow only Probaline’s addresses</p>
            <p className="m-0 text-ink-muted">
              {api.connector
                ? <>This API is reached through the connector “{api.connector}”: allow only that connector’s host in the API’s firewall or security group.</>
                : egressIps.length
                  ? <>Allow only {egressIps.join(', ')} in the API’s security group, WAF IP set or nginx <code className="font-mono">allow</code> list. This proves where a call came from, not who asked: use it with the check above where you can.</>
                  : <>The gateway’s outbound addresses aren’t set for this installation; ask your Probaline operator for them.</>}
            </p>
          </div>
        </>
      )}
    </Panel>
  );
}

// ── Incoming: MCP servers on laptops ────────────────────────────────────────────────────────────────────────

function LaptopScanPanel() {
  return (
    <Panel aria-label="MCP servers on laptops" className="px-6 py-5 flex flex-col gap-3">
      <div className="flex items-center gap-3"><h2 className="m-0 text-xl font-semibold">Laptops: find MCP servers people set up themselves</h2><Beta /></div>
      <p className="m-0 text-sm text-ink-muted max-w-[760px]">
        A read-only script for your device management (Jamf, Kandji, Intune). It lists the MCP servers in Claude Desktop, Claude Code, Cursor, VS Code and Windsurf: the app, the server’s name, the package or the URL’s host. It never reads or prints credentials, environment values or other arguments, and sends nothing anywhere.
      </p>
      <ol className="m-0 pl-5 text-sm flex flex-col gap-1 list-decimal">
        <li>Run it on every laptop (as root or SYSTEM it scans every account) and collect the output files.</li>
        <li>Give them to the collector with the other logs: <code className="font-mono">probaline-collector collect --out ./results ./mcp-scans</code>. Add <code className="font-mono">--company-domains acme.com</code> to the report to flag servers that reach your own systems.</li>
        <li>Upload the findings file above. Then offer each server as a Probaline MCP server and remove the local copies.</li>
      </ol>
      <div className="flex gap-2 flex-wrap">
        {SCAN_SCRIPTS.map((f) => <Button key={f.name} variant="secondary" onClick={() => download(f.name, f.body, 'text/plain')}>Download {f.name}</Button>)}
      </div>
      <p className="m-0 text-xs text-ink-muted">mcp-scan.sh (macOS) is tested; mcp-scan.ps1 (Windows) isn’t yet.</p>
    </Panel>
  );
}

function AwsLockPanel({ data, latestTo }: { data: Enforcement; latestTo?: string }) {
  const [s, setS] = useState<AwsSettings>({ sagemaker: true, ...data.aws });
  const [targets, setTargets] = useState((data.aws.targetIds ?? []).join(', '));
  const [result, setResult] = useState<AwsLock | null>(null);
  useEffect(() => { setResult(null); }, [latestTo]);
  const hosted = s.mode === 'hosted';
  const ready = hosted || !!s.gatewayRoleArn?.trim();
  const settings = (): AwsSettings => ({
    ...(hosted ? { mode: 'hosted' as const } : { mode: 'gateway' as const, gatewayRoleArn: (s.gatewayRoleArn ?? '').trim() }),
    ...(s.breakGlassRoleArn?.trim() ? { breakGlassRoleArn: s.breakGlassRoleArn.trim() } : {}),
    targetIds: targets.split(/[\s,]+/).filter(Boolean),
    sagemaker: s.sagemaker !== false,
  });
  const save = useMutation({ mutationFn: () => saveAws(settings()) });
  const gen = useMutation({ mutationFn: () => generateAws(settings()), onSuccess: setResult });
  const files = result ? [
    { name: 'probaline-scp.json', label: 'Service control policy', hint: 'Organizations → Policies → Service control policies. Attach to one OU first.', body: result.serviceControlPolicy },
    { name: 'probaline-vpc-endpoint-policy.json', label: 'VPC endpoint policy', hint: 'On the bedrock-runtime and sagemaker.runtime interface endpoints, if you use them.', body: result.vpcEndpointPolicy },
    { name: 'probaline-scp-cloudformation.json', label: 'CloudFormation template', hint: 'Deploy in the management account (or the delegated administrator for Organizations).', body: result.cloudFormation },
  ] : [];
  return (
    <Panel aria-label="AWS lock" className="px-6 py-5 flex flex-col gap-4 scroll-mt-24">
      <div>
        <div className="flex items-center gap-3"><h2 className="m-0 text-xl font-semibold">{hosted ? 'AWS: no direct Bedrock or SageMaker calls' : 'AWS: only the gateway calls Bedrock and SageMaker'}</h2><Beta /></div>
        <p className="m-0 mt-1 text-sm text-ink-muted max-w-[760px]">
          {hosted
            ? 'A service control policy for your AWS organization that refuses direct model calls from every role except an emergency role. Your AI requests go through Probaline’s cloud, which calls models from its own AWS account, so nothing in yours needs to. AWS has no warn-only mode for these, so check who it would stop first.'
            : 'A service control policy for your AWS organization that refuses direct model calls from every role except the gateway’s and an emergency role. AWS has no warn-only mode for these, so check who it would stop first.'}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {!hosted && <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Gateway role ARN</span>
          <input className={`${input} font-mono text-[13px]`} value={s.gatewayRoleArn ?? ''} placeholder="arn:aws:iam::123456789012:role/probaline-gateway-task" onChange={(e) => setS({ ...s, gatewayRoleArn: e.target.value })} />
        </label>}
        <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Emergency role ARN <span className="font-normal text-ink-muted">(recommended)</span></span>
          <input className={`${input} font-mono text-[13px]`} value={s.breakGlassRoleArn ?? ''} placeholder="arn:aws:iam::123456789012:role/ai-break-glass" onChange={(e) => setS({ ...s, breakGlassRoleArn: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Attach to <span className="font-normal text-ink-muted">(OU, root or account IDs)</span></span>
          <input className={`${input} font-mono text-[13px]`} value={targets} placeholder="ou-ab12-cdef3456" onChange={(e) => setTargets(e.target.value)} />
        </label>
        <div className="flex items-end gap-3 pb-2"><Switch checked={s.sagemaker !== false} onChange={(v) => setS({ ...s, sagemaker: v })} label="Also lock SageMaker endpoints" /><span className="text-sm font-semibold">Also lock SageMaker endpoints</span></div>
      </div>
      {(save.isError || gen.isError) && <p role="alert" className="m-0 text-sm text-stop">{errorMessage(save.error ?? gen.error)}</p>}
      <div className="flex gap-2 flex-wrap items-center">
        <Button disabled={!ready || gen.isPending} onClick={() => gen.mutate()}>{gen.isPending ? 'Writing…' : 'Write the policies'}</Button>
        <Button variant="secondary" disabled={!ready || save.isPending} onClick={() => save.mutate()}>Save settings</Button>
        {save.isSuccess && <span className="text-sm text-ink-muted">Saved.</span>}
      </div>
      {result && (
        <div className="flex flex-col gap-4">
          {result.problems.map((p) => <p key={p} role="alert" className="m-0 text-sm text-stop font-semibold">{p}</p>)}
          <div className="flex flex-col gap-2">
            <SectionLabel>Would be refused{result.findingsTo ? `, from findings to ${day(result.findingsTo)}` : ''}</SectionLabel>
            {result.wouldBeBlocked ? <BlockedTable rows={result.wouldBeBlocked} aws /> : <p className="m-0 text-sm text-ink-muted">Upload a findings file above to see who this would refuse.</p>}
          </div>
          <ul className="m-0 pl-5 text-sm text-ink-soft flex flex-col gap-1">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          {files.map((f) => {
            const body = JSON.stringify(f.body, null, 2);
            return (
              <div key={f.name} className="flex flex-col gap-1.5">
                <p className="m-0 text-sm"><strong>{f.label}</strong> <span className="text-ink-muted">· {f.hint}</span></p>
                <code className={code}>{body}</code>
                <div className="flex gap-2 flex-wrap"><CopyButton text={body} /><Button variant="secondary" onClick={() => download(f.name, body + '\n')}>Download</Button></div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────────────────────────────────

export function EnforcementPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['enforcement'], queryFn: getEnforcement, refetchInterval: 30_000 });
  const [adding, setAdding] = useState(false);
  const [urls, setUrls] = useState<NewFeedUrls | null>(null);

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">Enforcement</h1>
          <Beta />
        </div>
        <p className="m-0 mt-1.5 text-ink-muted text-[15px] max-w-[760px]">
          Each way AI can go around Probaline, what you’ve done about it, and what your logs show. Probaline writes the rules; you apply them in your firewall and AWS organization. Upload the collector’s findings after each run to keep the share current.
        </p>
      </div>

      {isError && <Panel className="px-6"><Note title="Couldn’t load enforcement."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}

      {data && (
        <>
          <section aria-label="Paths" className="flex flex-col gap-3">
            <h2 className="m-0 text-xl font-semibold">AI going out</h2>
            {data.paths.filter((p) => p.direction === 'out').map((p) => <PathRow key={p.id} p={p} />)}
            <h2 className="m-0 mt-2 text-xl font-semibold">Agents coming in</h2>
            {data.paths.filter((p) => p.direction === 'in').map((p) => <PathRow key={p.id} p={p} />)}
            <p className="m-0 text-xs text-ink-muted max-w-[760px]">The state is what you set; the share and who still goes direct come from the latest findings file. When they disagree, the row says so.</p>
          </section>

          <FindingsFiles data={data} />

          <section id="feed" aria-label="AI-domain feed" className="flex flex-col gap-3 scroll-mt-24">
            <div className="flex flex-wrap justify-between items-end gap-3">
              <div>
                <div className="flex items-center gap-3"><h2 className="m-0 text-xl font-semibold">Firewalls and DNS: AI only from the gateway</h2><Beta /></div>
                <p className="m-0 mt-1 text-sm text-ink-muted max-w-[760px]">
                  A list of AI domains your firewall, web gateway or DNS fetches every hour, from catalog {data.catalogVersion}. Block it for everyone except the gateway’s outbound addresses:{' '}
                  {data.egressIps.length ? <strong className="font-mono text-ink">{data.egressIps.join(', ')}</strong> : <span className="text-stop font-semibold">not set for this installation (ask your Probaline operator for them)</span>}.
                </p>
              </div>
              {!adding && data.feeds.length < data.maxFeeds && <Button onClick={() => setAdding(true)}>New feed</Button>}
            </div>
            {urls && <FeedUrls data={data} created={urls} onDone={() => setUrls(null)} />}
            {adding && (
              <Panel aria-label="New feed" className="px-6 py-5">
                <FeedForm data={data} latestTo={data.findings[0]?.to} onCancel={() => setAdding(false)} onCreated={(c) => { setAdding(false); setUrls(c); qc.invalidateQueries({ queryKey: ['enforcement'] }); }} />
              </Panel>
            )}
            {data.feeds.length === 0 && !adding && <Panel className="px-6"><Note title="No feeds yet.">Create one, then add its address to your firewall as an external list.</Note></Panel>}
            {data.feeds.map((f) => <FeedCard key={f.feedId} f={f} data={data} onUrls={setUrls} />)}
          </section>

          <div id="aws" className="scroll-mt-24"><AwsLockPanel data={data} latestTo={data.findings[0]?.to} /></div>
          <div id="apis" className="scroll-mt-24"><LockApisPanel egressIps={data.egressIps} /></div>
          <div id="laptops" className="scroll-mt-24"><LaptopScanPanel /></div>
        </>
      )}
    </div>
  );
}
