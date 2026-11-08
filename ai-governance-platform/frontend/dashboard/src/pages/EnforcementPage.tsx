import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AwsLock, AwsSettings, Blocked, createFeed, Enforcement, Feed, FeedCategory, feedContent, FeedFormat, Findings, generateAws,
  getEnforcement, NewFeedUrls, previewFeed, revokeFeed, rotateFeed, saveAws, slimFindings,
} from '../lib/enforcement-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Note, Panel, SectionLabel, Switch, formatCount } from '../components/kit/primitives';

const Beta = () => <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-line-subtle text-ink-soft">Beta</span>;
const input = 'min-h-[42px] px-3 border border-line-strong rounded-lg bg-white w-full';
const code = 'block bg-canvas border border-line-subtle rounded-lg px-3.5 py-3 font-mono text-[12.5px] [overflow-wrap:anywhere] whitespace-pre-wrap max-h-[320px] overflow-auto';

const when = (iso?: string) => iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const day = (d?: string) => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard unavailable */ } }}>{done ? 'Copied' : label}</Button>;
}

function download(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
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

// ── Findings file ───────────────────────────────────────────────────────────────────────────────────────────

function FindingsPicker({ findings, onChange }: { findings: Findings | null; onChange: (f: Findings | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel aria-label="Preview from your logs" className="px-6 py-5 flex flex-col gap-2">
      <SectionLabel>Preview from your logs</SectionLabel>
      <p className="m-0 text-sm text-ink-muted max-w-[760px]">
        Choose a findings file from the collector (<code className="font-mono">reports/findings-&lt;day&gt;.json</code>) to see who each lock would stop before you apply it.
        The file is read in your browser and sent only with each preview; it isn’t stored.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center min-h-[42px] px-4 rounded-lg border border-line-strong bg-white font-semibold text-sm cursor-pointer">
          {findings ? 'Choose another file' : 'Choose findings file'}
          <input type="file" accept="application/json,.json" className="sr-only" aria-label="Findings file" onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try { onChange(slimFindings(JSON.parse(await readText(file)))); setError(null); } catch (err) { setError((err as Error).message.startsWith('This') ? (err as Error).message : 'That file isn’t valid JSON.'); }
          }} />
        </label>
        {findings && <span className="text-sm">Using findings up to <strong>{day(findings.to)}</strong>.</span>}
        {findings && <button type="button" className="text-sm underline" onClick={() => onChange(null)}>Clear</button>}
      </div>
      {error && <p role="alert" className="m-0 text-sm text-stop">{error}</p>}
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

function FeedForm({ data, findings, onCreated, onCancel }: { data: Enforcement; findings: Findings | null; onCreated: (c: NewFeedUrls) => void; onCancel: () => void }) {
  const [name, setName] = useState('Firewalls');
  const [cats, setCats] = useState<FeedCategory[]>(data.defaultCategories);
  const preview = useQuery({ queryKey: ['feed-preview', cats, findings?.to], queryFn: () => previewFeed(cats, findings ?? undefined), enabled: cats.length > 0 });
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
              <p className="m-0">From your findings, this would stop: {blocked.services.length === 0 ? 'nothing in use.' : blocked.services.map((s) => `${s.name} (${formatCount(s.people + s.machines)} users or devices)`).join(', ')}</p>
              {blocked.apps.length > 0 && <><p className="m-0 font-semibold">Apps calling model APIs directly that would lose access until routed through Probaline:</p><BlockedTable rows={blocked.apps} /></>}
            </>
          )}
          {!findings && <p className="m-0 text-ink-muted">Choose a findings file above to see who this would stop.</p>}
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

function AwsLockPanel({ data, findings }: { data: Enforcement; findings: Findings | null }) {
  const [s, setS] = useState<AwsSettings>({ sagemaker: true, ...data.aws });
  const [targets, setTargets] = useState((data.aws.targetIds ?? []).join(', '));
  const [result, setResult] = useState<AwsLock | null>(null);
  useEffect(() => { setResult(null); }, [findings]);
  const settings = (): AwsSettings => ({
    gatewayRoleArn: s.gatewayRoleArn.trim(),
    ...(s.breakGlassRoleArn?.trim() ? { breakGlassRoleArn: s.breakGlassRoleArn.trim() } : {}),
    targetIds: targets.split(/[\s,]+/).filter(Boolean),
    sagemaker: s.sagemaker !== false,
  });
  const save = useMutation({ mutationFn: () => saveAws(settings()) });
  const gen = useMutation({ mutationFn: () => generateAws(settings(), findings ?? undefined), onSuccess: setResult });
  const files = result ? [
    { name: 'probaline-scp.json', label: 'Service control policy', hint: 'Organizations → Policies → Service control policies. Attach to one OU first.', body: result.serviceControlPolicy },
    { name: 'probaline-vpc-endpoint-policy.json', label: 'VPC endpoint policy', hint: 'On the bedrock-runtime and sagemaker.runtime interface endpoints, if you use them.', body: result.vpcEndpointPolicy },
    { name: 'probaline-scp-cloudformation.json', label: 'CloudFormation template', hint: 'Deploy in the management account (or the delegated administrator for Organizations).', body: result.cloudFormation },
  ] : [];
  return (
    <Panel aria-label="AWS lock" className="px-6 py-5 flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-3"><h2 className="m-0 text-xl font-semibold">AWS: only the gateway calls Bedrock and SageMaker</h2><Beta /></div>
        <p className="m-0 mt-1 text-sm text-ink-muted max-w-[760px]">A service control policy for your AWS organization that refuses direct model calls from every role except the gateway’s and an emergency role. AWS has no warn-only mode for these, so check who it would stop first.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Gateway role ARN</span>
          <input className={`${input} font-mono text-[13px]`} value={s.gatewayRoleArn} placeholder="arn:aws:iam::123456789012:role/probaline-gateway-task" onChange={(e) => setS({ ...s, gatewayRoleArn: e.target.value })} />
        </label>
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
        <Button disabled={!s.gatewayRoleArn.trim() || gen.isPending} onClick={() => gen.mutate()}>{gen.isPending ? 'Writing…' : 'Write the policies'}</Button>
        <Button variant="secondary" disabled={!s.gatewayRoleArn.trim() || save.isPending} onClick={() => save.mutate()}>Save settings</Button>
        {save.isSuccess && <span className="text-sm text-ink-muted">Saved.</span>}
      </div>
      {result && (
        <div className="flex flex-col gap-4">
          {result.problems.map((p) => <p key={p} role="alert" className="m-0 text-sm text-stop font-semibold">{p}</p>)}
          <div className="flex flex-col gap-2">
            <SectionLabel>Would be refused</SectionLabel>
            {result.wouldBeBlocked ? <BlockedTable rows={result.wouldBeBlocked} aws /> : <p className="m-0 text-sm text-ink-muted">Choose a findings file above to see who this would refuse.</p>}
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
  const [findings, setFindings] = useState<Findings | null>(null);
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
          Close the paths around Probaline. Probaline writes the rules; you apply them in your firewall and AWS organization. Then the collector report shows the share through Probaline, and anything still going direct.
        </p>
      </div>

      {isError && <Panel className="px-6"><Note title="Couldn’t load enforcement."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}

      {data && (
        <>
          <FindingsPicker findings={findings} onChange={setFindings} />

          <section aria-label="AI-domain feed" className="flex flex-col gap-3">
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
                <FeedForm data={data} findings={findings} onCancel={() => setAdding(false)} onCreated={(c) => { setAdding(false); setUrls(c); qc.invalidateQueries({ queryKey: ['enforcement'] }); }} />
              </Panel>
            )}
            {data.feeds.length === 0 && !adding && <Panel className="px-6"><Note title="No feeds yet.">Create one, then add its address to your firewall as an external list.</Note></Panel>}
            {data.feeds.map((f) => <FeedCard key={f.feedId} f={f} data={data} onUrls={setUrls} />)}
          </section>

          <AwsLockPanel data={data} findings={findings} />

          <p className="m-0 text-xs text-ink-muted max-w-[760px]">
            Coming next: one row per path showing open, previewing or locked next to the measured share, a kit to lock your own APIs to agents coming through Probaline, and finding MCP servers on laptops.
          </p>
        </>
      )}
    </div>
  );
}
