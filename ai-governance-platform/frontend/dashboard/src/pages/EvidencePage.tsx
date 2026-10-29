import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '../lib/auth';
import { RangeKey, RANGE_LABELS } from '../lib/gateway-api';
import { downloadEvidence, EvidenceListItem, EvidenceRecord, fetchEvidence, fetchEvidenceRecord, Outcome } from '../lib/evidence-api';
import { Button, Note, Panel, SectionLabel, Segmented } from '../components/aegis/primitives';

const RANGE_OPTIONS = (Object.keys(RANGE_LABELS) as RangeKey[]).map((value) => ({ value, label: RANGE_LABELS[value].button }));
const OUTCOMES: Array<{ value: Outcome | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'cleaned', label: 'Cleaned' },
  { value: 'delivered', label: 'Delivered' },
];

const VERB: Record<Outcome, { word: string; className: string }> = {
  stopped: { word: 'Stopped', className: 'text-stop' },
  cleaned: { word: 'Cleaned', className: 'text-ink' },
  delivered: { word: 'Delivered', className: 'text-ink-muted' },
};

function rowSentence(i: EvidenceListItem): string {
  if (i.outcome === 'stopped') return `a ${i.app} request: ${i.reason ?? 'blocked by policy'}.`;
  if (i.outcome === 'cleaned') return `personal data from a ${i.app} prompt, then sent it to ${i.model}.`;
  return `a ${i.app} request to ${i.model} with no findings.`;
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  const today = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return today ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

const STEP_DOT: Record<EvidenceRecord['steps'][number]['kind'], string> = {
  neutral: 'bg-ink',
  stopped: 'bg-stop',
  cleaned: 'bg-ink',
  skipped: 'bg-line-strong',
  delivered: 'bg-ink',
};

function CaseFile({ requestId }: { requestId: string }) {
  const { data: r, isLoading, isError } = useQuery({ queryKey: ['evidence-record', requestId], queryFn: () => fetchEvidenceRecord(requestId) });
  const [copied, setCopied] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  if (isLoading) return <Panel className="px-8 py-7"><p className="m-0 text-ink-muted">Loading record…</p></Panel>;
  if (isError || !r) return <Panel className="px-8"><Note title="Couldn’t load this record.">It may be outside your retention period, or belong to another tenant.</Note></Panel>;

  const label = r.outcome === 'stopped' ? 'Stopped · check 1, policy rules' : r.outcome === 'cleaned' ? 'Cleaned · check 3, personal data' : 'Delivered · no findings';
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };

  return (
    <Panel as="article" aria-label="Selected record" className="px-8 py-7 flex flex-col gap-6">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div className="min-w-0">
          <span className={clsx('text-xs font-bold uppercase tracking-[0.06em]', r.outcome === 'stopped' ? 'text-stop' : 'text-ink-muted')}>{label}</span>
          <h2 className="m-0 mt-1.5 text-[26px] leading-[1.15] font-bold tracking-[-0.02em]">{r.headline}</h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => downloadEvidence(r.requestId).then(() => setDownloadError(false), () => setDownloadError(true))}>Download evidence</Button>
          <Button variant="secondary" onClick={copyLink}>{copied ? 'Link copied' : 'Copy link'}</Button>
        </div>
      </div>
      {downloadError && <p role="alert" className="m-0 text-stop-text font-semibold">The download didn’t work. Try again.</p>}

      <dl className="m-0 grid gap-4 py-4 border-y border-line-subtle" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <div><dt className="text-xs text-ink-muted">When</dt><dd className="m-0 mt-0.5 font-semibold">{new Date(r.time).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</dd></div>
        <div><dt className="text-xs text-ink-muted">Person</dt><dd className="m-0 mt-0.5 font-semibold [overflow-wrap:anywhere]">{r.user}</dd></div>
        <div><dt className="text-xs text-ink-muted">From</dt><dd className="m-0 mt-0.5 font-semibold">{r.app}</dd></div>
        <div><dt className="text-xs text-ink-muted">Going to</dt><dd className="m-0 mt-0.5 font-semibold">{r.provider} · {r.model}</dd></div>
      </dl>

      <section aria-label="What happened">
        <SectionLabel className="mb-3">What happened</SectionLabel>
        <ol className="m-0 p-0 list-none flex flex-col">
          {r.steps.map((s, i) => (
            <li key={i} className="grid grid-cols-[20px_1fr] gap-3">
              <span className="flex flex-col items-center self-stretch">
                <span className={clsx('w-3 h-3 rounded-full mt-1', STEP_DOT[s.kind])} />
                {i < r.steps.length - 1 && <span className="flex-1 w-0.5 bg-line min-h-[22px]" />}
              </span>
              <span className="pb-3.5">
                <span className={clsx('font-semibold', s.kind === 'stopped' ? 'text-stop' : s.kind === 'skipped' ? 'text-ink-muted' : 'text-ink')}>{s.label}</span>{' '}
                <span className="text-ink-muted">{s.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {r.outcome === 'stopped' && (
        <section aria-label="What triggered it">
          <SectionLabel className="mb-3">What triggered it (personal data masked)</SectionLabel>
          <div className="bg-canvas border border-line-subtle rounded-[10px] px-4 py-3.5 font-mono text-[13px] leading-[1.7] text-ink-soft [overflow-wrap:anywhere]">
            {r.excerpt ? (
              <>{r.excerpt.before}<mark className="bg-stop-soft text-stop-text font-bold px-1 rounded">{r.excerpt.hit}</mark>{r.excerpt.after}</>
            ) : (
              <span className="text-ink-muted">No excerpt was kept for this request (recorded before excerpts were added).</span>
            )}
          </div>
        </section>
      )}

      <section aria-label="Proof" className="grid gap-4 pt-4 border-t border-line-subtle" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <div><div className="text-xs text-ink-muted">Request ID</div><div className="font-mono text-xs mt-0.5 [overflow-wrap:anywhere]">{r.requestId}</div></div>
        <div><div className="text-xs text-ink-muted">Prompt fingerprint (SHA-256)</div><div className="font-mono text-xs mt-0.5 [overflow-wrap:anywhere]" title={r.proof.promptFingerprint}>{r.proof.promptFingerprint.slice(0, 16)}…</div></div>
        <div><div className="text-xs text-ink-muted">Kept until</div><div className="mt-0.5">{new Date(r.proof.keptUntil).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
        {r.reason && <div><div className="text-xs text-ink-muted">Rule</div><div className="mt-0.5"><Link to="/rules" className="font-semibold text-ink hover:text-stop">{r.reason}</Link></div></div>}
        {r.usage && <div><div className="text-xs text-ink-muted">Usage</div><div className="mt-0.5">{r.usage.inputTokens + r.usage.outputTokens} tokens · ${r.usage.estimatedCost.toFixed(4)}</div></div>}
      </section>
    </Panel>
  );
}

export function EvidencePage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const range = (params.get('range') as RangeKey) || 'week';
  const outcome = (params.get('outcome') as Outcome | 'all') || 'all';
  const q = params.get('q') ?? '';
  const selected = params.get('id');
  const [search, setSearch] = useState(q);

  const update = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  };

  // Apply typed search after a short pause rather than on every keystroke.
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => update({ q: search || null, id: null }), 300);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useInfiniteQuery({
    queryKey: ['evidence', user?.tenantId, range, outcome, q],
    queryFn: ({ pageParam }) => fetchEvidence(range, outcome, q, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    placeholderData: keepPreviousData,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const current = selected ?? items[0]?.requestId ?? null;

  return (
    <div className="flex flex-wrap gap-6 items-start">
      <section aria-label="Records" className="flex-[1_1_440px] min-w-0 flex flex-col gap-3.5">
        <div>
          <h1 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">Evidence</h1>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px]">Every decision the gateway made, with what happened and why.</p>
        </div>
        <Segmented label="Time range" options={RANGE_OPTIONS} value={range} onChange={(v) => update({ range: v, id: null })} />
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-ink-muted">Search people, apps, rules or request IDs</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            className="min-h-[44px] px-3.5 border border-line-strong rounded-[10px] bg-white" />
        </label>
        <div role="group" aria-label="Outcome" className="flex gap-2 flex-wrap">
          {OUTCOMES.map((o) => (
            <button key={o.value} type="button" aria-pressed={outcome === o.value} onClick={() => update({ outcome: o.value === 'all' ? null : o.value, id: null })}
              className={clsx('min-h-[36px] px-3 rounded-full border', outcome === o.value ? 'bg-ink text-white border-ink font-semibold' : 'bg-white border-line-strong')}>
              {o.label}
            </button>
          ))}
        </div>

        {list.isError && <Panel className="px-5"><Note title="Couldn’t load records."><button type="button" className="underline font-semibold" onClick={() => list.refetch()}>Try again</button></Note></Panel>}
        {list.isLoading && <Panel className="px-5 py-4"><p className="m-0 text-ink-muted">Loading…</p></Panel>}
        {list.data && items.length === 0 && (
          <Panel className="px-5"><Note title="No records match.">Try a longer time range, another outcome, or a different search.</Note></Panel>
        )}
        {items.length > 0 && (
          <>
            <p className="m-0 text-xs text-ink-muted">{total.toLocaleString()} {total === 1 ? 'record' : 'records'}{list.data?.pages[0]?.truncated ? ' (range has more than shown; narrow it to see all)' : ''}</p>
            <Panel className="overflow-hidden">
              <ul className="m-0 p-0 list-none">
                {items.map((i) => {
                  const active = i.requestId === current;
                  const verb = VERB[i.outcome];
                  return (
                    <li key={i.requestId} className="border-b border-line-subtle last:border-b-0">
                      <button type="button" aria-current={active ? 'true' : undefined} onClick={() => update({ id: i.requestId })}
                        className={clsx('w-full text-left grid grid-cols-[72px_1fr] gap-3 px-[18px] py-3.5', active ? 'bg-ink-tint shadow-[inset_3px_0_0_#14213D]' : 'hover:bg-canvas')}>
                        <span className="font-mono text-xs text-ink-muted pt-0.5">{shortTime(i.time)}</span>
                        <span>
                          <span className={clsx('font-bold', verb.className)}>{verb.word}</span> {rowSentence(i)}
                          <span className="block text-xs text-ink-muted">{i.user} · {i.model}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Panel>
            {list.hasNextPage && (
              <Button variant="secondary" className="self-start" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </Button>
            )}
          </>
        )}
      </section>

      <div className="flex-[999_1_560px] min-w-0">
        {current ? <CaseFile requestId={current} /> : list.data && <Panel className="px-8"><Note title="Select a record to see what happened." /></Panel>}
      </div>
    </div>
  );
}
