import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '../lib/auth';
import { fetchGatewaySummary, GatewaySummary, RangeKey, RANGE_LABELS } from '../lib/gateway-api';
import { Pipeline } from '../components/aegis/Pipeline';
import { ArrowLink, ButtonLink, Note, Panel, SectionLabel, Segmented, formatCount } from '../components/aegis/primitives';

const RANGE_OPTIONS = (Object.keys(RANGE_LABELS) as RangeKey[]).map((value) => ({ value, label: RANGE_LABELS[value].button }));

function Headline({ summary, range, tenantName }: { summary: GatewaySummary; range: RangeKey; tenantName: string }) {
  const when = RANGE_LABELS[range].phrase;
  if (summary.received === 0) {
    return <>{when}, no AI requests have gone through the gateway yet.</>;
  }
  if (summary.stopped === 0) {
    return (
      <>
        {when}, all {formatCount(summary.received)} AI requests passed the checks
        {summary.cleaned > 0 && <>, and {formatCount(summary.cleaned)} were cleaned of personal data first</>}.
      </>
    );
  }
  return (
    <>
      {when}, Aegis stopped <span className="text-stop">{formatCount(summary.stopped)}</span> risky AI{' '}
      {summary.stopped === 1 ? 'request' : 'requests'}
      {summary.cleaned > 0 && <> and cleaned {formatCount(summary.cleaned)} more</>} before they left {tenantName}.
    </>
  );
}

interface Decision {
  key: string;
  lead: string;
  emphasis: string;
  tail: string;
  red: boolean;
  detail: string;
  primary: { label: string; to: string };
  secondary?: { label: string; to: string };
}

/** Only things the data actually supports; no invented alerts. */
function decisionsFrom(summary: GatewaySummary): Decision[] {
  const out: Decision[] = [];
  const top = summary.topStopReasons[0];
  if (top) {
    out.push({
      key: 'top-stop',
      lead: `${formatCount(top.count)} ${top.count === 1 ? 'request was' : 'requests were'}`,
      emphasis: 'stopped',
      tail: `by “${top.reason}”.`,
      red: true,
      detail: 'Check whether these are expected, or whether the rule needs adjusting.',
      primary: { label: 'See the requests', to: '/audit-logs' },
      secondary: { label: 'Review rules', to: '/policies' },
    });
  }
  if (summary.shadowAi.people > 0) {
    out.push({
      key: 'shadow',
      lead: `${formatCount(summary.shadowAi.people)} ${summary.shadowAi.people === 1 ? 'person went' : 'people went'}`,
      emphasis: 'around',
      tail: 'the gateway.',
      red: true,
      detail: `${formatCount(summary.shadowAi.visits)} visits to AI tools that don’t pass through Aegis, seen by the browser extension.`,
      primary: { label: 'Review shadow AI', to: '/shadow-ai' },
    });
  }
  return out;
}

const OUTCOME_STYLE = {
  stopped: { verb: 'Stopped', className: 'text-stop' },
  cleaned: { verb: 'Cleaned', className: 'text-ink' },
  delivered: { verb: 'Delivered', className: 'text-ink-muted' },
} as const;

function sentence(e: GatewaySummary['recent'][number]): string {
  if (e.outcome === 'stopped') return `a ${e.app} request to ${e.model}: ${e.reason ?? 'blocked by policy'}.`;
  if (e.outcome === 'cleaned') return `personal data from a ${e.app} prompt, then sent it to ${e.model}.`;
  return `a ${e.app} request to ${e.model} with no findings.`;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function GatewayPage() {
  const { user, isAdmin } = useAuth();
  const [range, setRange] = useState<RangeKey>('week');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['gateway-summary', user?.tenantId, range],
    queryFn: () => fetchGatewaySummary(range),
    refetchInterval: 30_000,
  });

  const decisions = data ? decisionsFrom(data) : [];

  return (
    <div className="flex flex-col gap-8 max-w-[1360px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 text-[40px] sm:text-[46px] leading-[1.08] font-bold tracking-[-0.028em] max-w-[1080px] min-h-[1em]">
          {data ? <Headline summary={data} range={range} tenantName={user?.tenantName ?? 'your company'} /> : 'Gateway'}
        </h1>
        <Segmented label="Time range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
      </div>

      {isError && (
        <Panel className="px-6">
          <Note title="Couldn’t load gateway activity.">
            The gateway may be unreachable. <button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button>
          </Note>
        </Panel>
      )}

      {isLoading && (
        <Panel className="px-7 py-6" aria-label="Gateway pipeline">
          <p className="m-0 text-ink-muted">Loading gateway activity…</p>
        </Panel>
      )}

      {data && (
        <>
          <Panel className="px-7 pt-7 pb-5" aria-label="Gateway pipeline">
            <Pipeline summary={data} />
            <p className="m-0 mt-1 text-xs text-ink-muted">
              Red lines are requests stopped at the gateway; the dashed line is requests cleaned of personal data and sent on.
              {data.truncated && ' This range has more activity than shown here; numbers are a lower bound.'}
            </p>
          </Panel>

          {data.received === 0 ? (
            <Panel className="px-7 py-6" aria-label="Get started">
              <SectionLabel>Connect your first app</SectionLabel>
              <p className="m-0 mt-3 max-w-[720px] text-[15px]">
                Point an app at the gateway’s OpenAI-compatible endpoint with an Aegis API key, and its requests will appear here
                as they pass through the checks.
              </p>
              {isAdmin && (
                <div className="mt-4 flex gap-2 flex-wrap">
                  <ButtonLink to="/models">Set up models and keys</ButtonLink>
                </div>
              )}
            </Panel>
          ) : (
            <div className="flex flex-wrap gap-6 items-start">
              <section aria-label="Needs a decision" className="flex-[1_1_460px] min-w-0 flex flex-col gap-3.5">
                <SectionLabel>Needs a decision</SectionLabel>
                {decisions.length === 0 ? (
                  <Panel className="px-5"><Note title="Nothing needs a decision right now." /></Panel>
                ) : (
                  decisions.map((d) => (
                    <Panel key={d.key} as="article" className="px-5 py-[18px] flex flex-col gap-2.5">
                      <p className="m-0 text-[21px] leading-[1.2] font-bold tracking-[-0.015em]">
                        {d.lead} <span className={clsx(d.red && 'text-stop')}>{d.emphasis}</span> {d.tail}
                      </p>
                      <p className="m-0 text-ink-muted">{d.detail}</p>
                      <div className="flex gap-2 flex-wrap">
                        <ButtonLink to={d.primary.to}>{d.primary.label}</ButtonLink>
                        {d.secondary && <ButtonLink to={d.secondary.to} variant="secondary">{d.secondary.label}</ButtonLink>}
                      </div>
                    </Panel>
                  ))
                )}
              </section>

              <Panel aria-label="Just now" className="flex-[1_1_420px] min-w-0 px-5 py-[18px] flex flex-col">
                <div className="flex justify-between items-baseline mb-1.5">
                  <SectionLabel>Just now</SectionLabel>
                  <ArrowLink to="/audit-logs">Evidence log</ArrowLink>
                </div>
                {data.recent.map((e, i) => {
                  const style = OUTCOME_STYLE[e.outcome];
                  return (
                    <div key={i} className="grid grid-cols-[84px_1fr] gap-3 py-[11px] border-b border-line-subtle last:border-b-0">
                      <span className="font-mono text-xs text-ink-muted pt-0.5">{timeOf(e.time)}</span>
                      <span>
                        <span className={clsx('font-bold', style.className)}>{style.verb}</span> {sentence(e)}
                        <span className="block text-xs text-ink-muted">{e.user}</span>
                      </span>
                    </div>
                  );
                })}
              </Panel>
            </div>
          )}
        </>
      )}
    </div>
  );
}
