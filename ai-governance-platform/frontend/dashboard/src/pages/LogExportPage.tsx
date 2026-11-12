import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  createDestination, DeadLetterSummary, deleteDestination, Destination, DestinationInput, DestinationKind, discardDeadLetter, getDeadLetter,
  getLogExport, listDeadLetters, RecordChoice, retryDeadLetter, rotateSecret, testDestination, TestResult, updateDestination,
} from '../lib/log-export-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Note, Panel, SectionLabel, Switch, formatCount } from '../components/kit/primitives';

const KINDS: Array<{ value: DestinationKind; label: string; hint: string }> = [
  { value: 'webhook', label: 'HTTPS webhook', hint: 'JSON batches, signed. Any HTTP collector, Sumo Logic HTTP source, your own endpoint.' },
  { value: 'splunk_hec', label: 'Splunk HEC', hint: 'Splunk Enterprise or Splunk Cloud, through the HTTP Event Collector.' },
  { value: 'otlp_http', label: 'OpenTelemetry (OTLP/HTTP)', hint: 'An OpenTelemetry Collector, Datadog, Elastic, Grafana and other OTLP log intakes.' },
];
const KIND_LABEL: Record<DestinationKind, string> = { webhook: 'HTTPS webhook', splunk_hec: 'Splunk HEC', otlp_http: 'OpenTelemetry' };

const TYPES: Array<{ value: RecordChoice; label: string; hint: string }> = [
  { value: 'decisions', label: 'Decisions', hint: 'Every AI request and MCP tool call: allowed or stopped, and why. Never the prompt.' },
  { value: 'admin_activity', label: 'Admin activity', hint: 'Rules, keys, MCP servers, approvals and settings changed, by whom.' },
  { value: 'sign_ins', label: 'Sign-ins', hint: 'Dashboard sign-ins, refused API keys, people signing in to MCP servers.' },
];
const TYPE_LABEL: Record<string, string> = { decisions: 'Decisions', admin_activity: 'Admin activity', sign_ins: 'Sign-ins', decision: 'Decisions', sign_in: 'Sign-ins' };

/** Which tool goes with which destination. Honest about what's direct and what goes through a collector. */
const TOOLS: Array<{ tool: string; how: string; status: 'Tested' | 'Beta' | 'Through a collector' }> = [
  { tool: 'Splunk', how: 'Splunk HEC (Splunk Enterprise or Splunk Cloud)', status: 'Tested' },
  { tool: 'Datadog', how: 'OpenTelemetry, to the Datadog Agent or OTLP intake', status: 'Beta' },
  { tool: 'Elastic', how: 'OpenTelemetry, to Elastic’s OTLP endpoint (APM Server or Elastic Cloud)', status: 'Tested' },
  { tool: 'Sumo Logic', how: 'HTTPS webhook to an HTTP source (or OpenTelemetry)', status: 'Beta' },
  { tool: 'Microsoft Sentinel', how: 'OpenTelemetry Collector with the Azure Monitor exporter', status: 'Through a collector' },
  { tool: 'Syslog', how: 'OpenTelemetry Collector with the syslog exporter', status: 'Through a collector' },
];


function ago(iso?: string) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const input = 'min-h-[42px] px-3 border border-line-strong rounded-lg bg-white w-full';

/** Shows a webhook signing secret once. */
function NewSecret({ value, onDone }: { value: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Panel aria-label="Signing secret" className="px-6 py-5 border-2 border-ink flex flex-col gap-3">
      <p className="m-0 font-semibold">Copy the signing secret now. It won’t be shown again.</p>
      <p className="m-0 text-sm text-ink-muted">Your endpoint checks the <code className="font-mono">x-probaline-signature</code> header with it: <code className="font-mono">t=&lt;time&gt;,v1=&lt;HMAC-SHA256 of “t.body”&gt;</code>.</p>
      <code className="block bg-canvas border border-line-subtle rounded-lg px-3.5 py-3 font-mono text-[13px] [overflow-wrap:anywhere]">{value}</code>
      <div className="flex gap-2 flex-wrap">
        <Button onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); } catch { /* clipboard unavailable */ } }}>{copied ? 'Copied' : 'Copy secret'}</Button>
        <Button variant="secondary" onClick={onDone}>I’ve saved it</Button>
      </div>
    </Panel>
  );
}

function DestinationForm({ existing, onSaved, onCancel }: { existing?: Destination; onSaved: (secret?: string) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<DestinationKind>(existing?.kind ?? 'webhook');
  const [name, setName] = useState(existing?.name ?? '');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [index, setIndex] = useState(existing?.splunkIndex ?? '');
  const [headers, setHeaders] = useState<Array<{ name: string; value: string }>>(existing?.headerNames?.map((n) => ({ name: n, value: '' })) ?? []);
  const [types, setTypes] = useState<RecordChoice[]>(existing?.recordTypes ?? ['decisions', 'admin_activity', 'sign_ins']);
  const save = useMutation({
    mutationFn: async () => {
      if (!existing) {
        const body: DestinationInput = { kind, name: name.trim(), url: url.trim(), recordTypes: types };
        if (kind === 'splunk_hec') { body.token = token.trim(); if (index.trim()) body.splunkIndex = index.trim(); }
        if (kind === 'otlp_http') body.headers = headers.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), value: h.value }));
        return createDestination(body);
      }
      const body: DestinationInput = { name: name.trim(), recordTypes: types };
      if (url.trim()) body.url = url.trim();
      if (kind === 'splunk_hec') { if (token.trim()) body.token = token.trim(); body.splunkIndex = index.trim(); }
      // Header values are secret and never sent back; only send headers when all values are filled in again.
      if (kind === 'otlp_http' && headers.every((h) => !h.name.trim() || h.value)) body.headers = headers.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), value: h.value }));
      return updateDestination(existing.destinationId, body);
    },
    onSuccess: (r) => onSaved((r as { signingSecret?: string }).signingSecret),
  });
  const ready = name.trim() && (existing || url.trim()) && types.length > 0 && (kind !== 'splunk_hec' || existing || token.trim()) && !save.isPending;

  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
      {!existing && (
        <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
          <legend className="text-sm font-semibold mb-1">Send to</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {KINDS.map((k) => (
              <label key={k.value} className={clsx('flex gap-2.5 items-start border rounded-lg px-3.5 py-3 cursor-pointer', kind === k.value ? 'border-ink border-2' : 'border-line-strong')}>
                <input type="radio" name="kind" className="mt-1" checked={kind === k.value} onChange={() => setKind(k.value)} />
                <span><span className="font-semibold block">{k.label}</span><span className="text-sm text-ink-muted">{k.hint}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className="flex flex-col gap-1.5 max-w-[420px]">
        <span className="text-sm font-semibold">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Security SIEM" className={input} />
      </label>
      <label className="flex flex-col gap-1.5 max-w-[640px]">
        <span className="text-sm font-semibold">Address</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoComplete="off"
          placeholder={existing ? `${existing.urlHint} (leave blank to keep)` : kind === 'splunk_hec' ? 'https://splunk.example.com:8088' : kind === 'otlp_http' ? 'https://otel-collector.example.com:4318' : 'https://logs.example.com/probaline'}
          className={input} />
        <span className="text-xs text-ink-muted">
          {kind === 'splunk_hec' ? 'The HEC address; /services/collector/event is added if you give only the host.'
            : kind === 'otlp_http' ? 'The collector’s OTLP/HTTP address; /v1/logs is added if you give only the host.'
              : 'Kept in the secret store, since some tools put a token in the address.'}
        </span>
      </label>
      {kind === 'splunk_hec' && (
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5 flex-[1_1_280px] max-w-[420px]">
            <span className="text-sm font-semibold">HEC token</span>
            <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" placeholder={existing?.secretHint ? `${existing.secretHint} (leave blank to keep)` : ''} className={input} />
          </label>
          <label className="flex flex-col gap-1.5 flex-[1_1_180px] max-w-[240px]">
            <span className="text-sm font-semibold">Index <span className="font-normal text-ink-muted">(optional)</span></span>
            <input value={index} onChange={(e) => setIndex(e.target.value)} placeholder="token’s default" className={input} />
          </label>
        </div>
      )}
      {kind === 'otlp_http' && (
        <fieldset className="m-0 p-0 border-0 flex flex-col gap-2 max-w-[640px]">
          <legend className="text-sm font-semibold mb-1">Headers <span className="font-normal text-ink-muted">(optional: API keys your collector needs, e.g. DD-API-KEY or Authorization)</span></legend>
          {headers.map((h, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <input aria-label="Header name" value={h.name} onChange={(e) => setHeaders(headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" className={clsx(input, 'flex-[1_1_160px] w-auto')} />
              <input aria-label="Header value" value={h.value} type="password" autoComplete="off" onChange={(e) => setHeaders(headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={existing ? 'Value (enter again to change)' : 'Value'} className={clsx(input, 'flex-[2_1_220px] w-auto')} />
              <Button type="button" variant="ghost" onClick={() => setHeaders(headers.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          {headers.length < 10 && <div><Button type="button" variant="secondary" onClick={() => setHeaders([...headers, { name: '', value: '' }])}>Add a header</Button></div>}
        </fieldset>
      )}
      <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
        <legend className="text-sm font-semibold mb-1">What to send</legend>
        {TYPES.map((t) => (
          <label key={t.value} className="flex items-start gap-2.5 min-h-[32px]">
            <input type="checkbox" className="mt-1" checked={types.includes(t.value)} onChange={(e) => setTypes(e.target.checked ? [...types, t.value] : types.filter((x) => x !== t.value))} />
            <span><span className="font-medium">{t.label}</span> <span className="text-ink-muted">· {t.hint}</span></span>
          </label>
        ))}
      </fieldset>
      {save.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(save.error)}</p>}
      <div className="flex gap-2 flex-wrap">
        <Button type="submit" disabled={!ready}>{save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Add destination'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function DestinationCard({ d, onSecret }: { d: Destination; onSecret: (s: string) => void }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['log-export'] });
  const [editing, setEditing] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const toggle = useMutation({ mutationFn: () => updateDestination(d.destinationId, { enabled: !d.enabled }), onSuccess: refresh });
  const runTest = useMutation({ mutationFn: () => testDestination(d.destinationId), onSuccess: (r) => { setTest(r); refresh(); } });
  const rotate = useMutation({ mutationFn: () => rotateSecret(d.destinationId), onSuccess: (r) => { onSecret(r.signingSecret); refresh(); } });
  const remove = useMutation({ mutationFn: () => deleteDestination(d.destinationId), onSuccess: refresh });
  const error = toggle.error ?? runTest.error ?? rotate.error ?? remove.error;

  if (editing) {
    return (
      <Panel className="px-6 py-5">
        <SectionLabel className="mb-3">Edit {d.name}</SectionLabel>
        <DestinationForm existing={d} onSaved={() => { setEditing(false); refresh(); }} onCancel={() => setEditing(false)} />
      </Panel>
    );
  }

  return (
    <Panel as="article" className={clsx('px-[22px] py-[18px] flex flex-col gap-3', !d.enabled && 'opacity-80')}>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex-[1_1_260px] min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="m-0 text-lg font-bold">{d.name}</h2>
            <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', d.enabled ? 'bg-ink text-white' : 'bg-line-subtle text-ink-soft')}>{d.enabled ? 'Sending' : 'Paused'}</span>
          </div>
          <div className="text-sm text-ink-muted mt-0.5">{KIND_LABEL[d.kind]} · <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{d.urlHint}</span></div>
          <div className="text-sm mt-1">{d.recordTypes.map((t) => TYPE_LABEL[t]).join(' · ')}</div>
          {(d.secretHint || d.headerNames?.length) && (
            <div className="text-xs text-ink-muted mt-1">
              {d.kind === 'webhook' ? `Signing secret ${d.secretHint}` : d.kind === 'splunk_hec' ? `Token ${d.secretHint}` : `Headers: ${d.headerNames?.join(', ')}`}
              {' '}· in the secret store
            </div>
          )}
        </div>
        <dl className="m-0 flex gap-6 text-sm flex-wrap">
          <div><dt className="text-xs text-ink-muted">Delivered</dt><dd className="m-0 font-semibold">{formatCount(d.deliveredCount)}</dd></div>
          <div><dt className="text-xs text-ink-muted">Last sent</dt><dd className="m-0">{ago(d.lastDeliveredAt)}</dd></div>
          <div><dt className="text-xs text-ink-muted">Not delivered</dt><dd className={clsx('m-0', d.deadLetterCount > 0 && 'text-stop-text font-semibold')}>{formatCount(d.deadLetterCount)}</dd></div>
        </dl>
        <div className="flex items-center gap-2">
          <Switch checked={d.enabled} label={d.enabled ? `Pause ${d.name}` : `Resume ${d.name}`} disabled={toggle.isPending} onChange={() => toggle.mutate()} />
        </div>
      </div>
      {d.retrying && (
        <p className="m-0 text-sm text-stop-text">
          {formatCount(d.retrying.count)} records waiting: try {d.retrying.attempts} failed, next try at {new Date(d.retrying.nextAttemptAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.
          {d.lastError && <span className="block text-ink-muted [overflow-wrap:anywhere]">{d.lastError}</span>}
        </p>
      )}
      {!d.retrying && d.lastError && <p className="m-0 text-sm text-ink-muted [overflow-wrap:anywhere]">Last problem: {d.lastError}</p>}
      {test && (
        <p role="status" className={clsx('m-0 text-sm font-semibold [overflow-wrap:anywhere]', test.ok ? 'text-ink' : 'text-stop-text')}>
          {test.ok ? '✓ ' : ''}Test: {test.message}
        </p>
      )}
      <div className="flex gap-2 flex-wrap">
        <Button variant="secondary" disabled={runTest.isPending} onClick={() => runTest.mutate()}>{runTest.isPending ? 'Sending…' : 'Send a test'}</Button>
        <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
        {d.kind === 'webhook' && <Button variant="secondary" disabled={rotate.isPending} onClick={() => rotate.mutate()}>New signing secret</Button>}
        {!confirmRemove && <Button variant="ghost" onClick={() => setConfirmRemove(true)}>Remove</Button>}
        {confirmRemove && (
          <span className="inline-flex gap-2 items-center flex-wrap">
            <span className="text-sm">Stop sending and remove its secrets?</span>
            <Button variant="secondary" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>Keep</Button>
          </span>
        )}
      </div>
      {error && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(error)}</p>}
    </Panel>
  );
}

function DeadLetterRow({ dl }: { dl: DeadLetterSummary }) {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ['log-export'] }); qc.invalidateQueries({ queryKey: ['log-export-dead'] }); };
  const [result, setResult] = useState<string | null>(null);
  const retry = useMutation({ mutationFn: () => retryDeadLetter(dl.entryId), onSuccess: (r) => { setResult(r.message); refresh(); }, onError: (e) => setResult(errorMessage(e)) });
  const discard = useMutation({ mutationFn: () => discardDeadLetter(dl.entryId), onSuccess: refresh });
  const download = async () => {
    const data = await getDeadLetter(dl.entryId);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `probaline-undelivered-${dl.entryId}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <li className="px-5 py-4 border-b border-line-subtle last:border-b-0 flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 items-baseline">
        <span className="font-semibold">{formatCount(dl.count)} {dl.types.map((t) => TYPE_LABEL[t] ?? t).join(', ').toLowerCase()} records</span>
        <span className="text-sm text-ink-muted">to {dl.destinationName} · {dl.firstRecordAt ? ago(dl.firstRecordAt) : ''}{dl.lastRecordAt && dl.lastRecordAt !== dl.firstRecordAt ? ` – ${ago(dl.lastRecordAt)}` : ''}</span>
      </div>
      <p className="m-0 text-sm text-stop-text [overflow-wrap:anywhere]">{dl.error} ({dl.attempts} tries)</p>
      <p className="m-0 text-xs text-ink-muted">Kept until {new Date(dl.keptUntil).toLocaleDateString([], { day: 'numeric', month: 'short' })}</p>
      {result && <p role="status" className="m-0 text-sm font-semibold [overflow-wrap:anywhere]">{result}</p>}
      <div className="flex gap-2 flex-wrap">
        <Button variant="secondary" disabled={retry.isPending} onClick={() => retry.mutate()}>{retry.isPending ? 'Sending…' : 'Send again'}</Button>
        <Button variant="secondary" onClick={() => void download()}>Download</Button>
        <Button variant="ghost" disabled={discard.isPending} onClick={() => discard.mutate()}>Discard</Button>
      </div>
    </li>
  );
}

/** Settings → Log export: send this company's records to its own log tools. */
export function LogExportPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['log-export'], queryFn: getLogExport, refetchInterval: 15_000 });
  const dead = useQuery({ queryKey: ['log-export-dead', data?.deadLetters], queryFn: listDeadLetters, enabled: !!data && data.deadLetters > 0 });
  const full = !!data && data.destinations.length >= data.maxDestinations;

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">Log export</h1>
          </div>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px] max-w-[760px]">
            Send decisions, <Link to="/activity" className="font-semibold text-ink">admin activity and sign-ins</Link> to your SIEM or log tools as they happen.
            Records go in batches within about a minute. A destination that’s down is retried for about 15 minutes, then the batch waits below for you.
          </p>
        </div>
        {!adding && !full && <Button onClick={() => setAdding(true)}>Add a destination</Button>}
      </div>

      {secret && <NewSecret value={secret} onDone={() => setSecret(null)} />}

      {adding && (
        <Panel aria-label="New destination" className="px-6 py-5">
          <SectionLabel className="mb-3">New destination</SectionLabel>
          <DestinationForm onSaved={(s) => { setAdding(false); if (s) setSecret(s); qc.invalidateQueries({ queryKey: ['log-export'] }); }} onCancel={() => setAdding(false)} />
        </Panel>
      )}

      {isError && <Panel className="px-6"><Note title="Couldn’t load log export."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}
      {data && data.destinations.length === 0 && !adding && (
        <Panel className="px-6"><Note title="No destinations yet.">Add one to start sending. Records from before you add it aren’t sent.</Note></Panel>
      )}
      {data && data.destinations.length > 0 && (
        <div className="flex flex-col gap-3">
          {data.destinations.map((d) => <DestinationCard key={d.destinationId} d={d} onSecret={setSecret} />)}
        </div>
      )}

      {data && data.deadLetters > 0 && (
        <section aria-labelledby="dead-title" className="flex flex-col gap-3">
          <h2 id="dead-title" className="m-0 text-xl font-bold">Not delivered</h2>
          <p className="m-0 text-ink-muted">These batches failed every try. Send them again once the destination works, or download them. Kept 30 days.</p>
          <Panel>
            {dead.isLoading && <p className="m-0 px-5 py-4 text-ink-muted">Loading…</p>}
            {dead.data && <ul className="m-0 p-0 list-none">{dead.data.map((dl) => <DeadLetterRow key={dl.entryId} dl={dl} />)}</ul>}
          </Panel>
        </section>
      )}

      <Panel className="px-6 py-5">
        <SectionLabel className="mb-2">Which destination for your tool</SectionLabel>
        <ul className="m-0 p-0 list-none">
          {TOOLS.map((t) => (
            <li key={t.tool} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2.5 border-b border-line-subtle last:border-b-0">
              <span className="font-semibold w-[160px] flex-none">{t.tool}</span>
              <span className="flex-[1_1_240px] text-ink-soft">{t.how}</span>
              <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', t.status === 'Tested' ? 'bg-ink text-white' : t.status === 'Beta' ? 'bg-line-subtle text-ink-soft' : 'bg-canvas text-ink-muted border border-line')}>{t.status}</span>
            </li>
          ))}
        </ul>
        <p className="m-0 mt-3 text-sm text-ink-muted">
          Tested: records checked arriving in that product. Beta: the format follows the tool’s published intake, but hasn’t been checked in the product yet. Every record has the same fields
          (schema <code className="font-mono">probaline.log/1</code>); prompts and answers are never sent.
        </p>
      </Panel>
    </div>
  );
}
