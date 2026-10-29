import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '../lib/auth';
import { fetchStopped, RangeKey, RANGE_LABELS, StoppedSummary } from '../lib/gateway-api';
import { ArrowLink, ButtonLink, Note, Panel, Segmented, formatCount } from '../components/aegis/primitives';

const RANGE_OPTIONS = (Object.keys(RANGE_LABELS) as RangeKey[]).map((value) => ({ value, label: RANGE_LABELS[value].button }));

type Cause = StoppedSummary['causes'][number];
type Filter = 'all' | 'policy';

const RULE_KIND: Record<string, string> = {
  keyword_block: 'Keyword rule',
  model_restriction: 'Approved models',
  pii_detection: 'Personal data rule',
  data_classification: 'Custom pattern',
};

function DayBars({ days }: { days: StoppedSummary['byDay'] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const few = days.length <= 8;
  const total = days.reduce((s, d) => s + d.count, 0);
  return (
    <div role="img" aria-label={`Stopped per day: ${days.map((d) => `${d.date} ${d.count}`).join(', ')}`} className="flex items-end gap-1.5 h-16">
      {days.map((d) => {
        const weekday = new Date(d.date + 'T12:00:00').toLocaleDateString([], { weekday: 'narrow' });
        return (
          <div key={d.date} className="flex flex-col items-center justify-end gap-1 h-full">
            <div
              className={clsx('rounded-t-[3px]', d.count > 0 ? 'bg-stop' : 'bg-line', few ? 'w-[22px]' : 'w-[7px]')}
              style={{ height: d.count > 0 ? Math.max(4, Math.round((d.count / max) * 44)) : 2 }}
            />
            {few && <span aria-hidden="true" className="text-[11px] text-ink-muted">{weekday}</span>}
          </div>
        );
      })}
      {total === 0 && <span className="sr-only">No stopped requests in this range</span>}
    </div>
  );
}

function whoLine(c: Cause): string {
  const apps = c.apps.map((a) => (c.apps.length > 1 ? `${a.name} (${formatCount(a.count)})` : a.name)).join(' · ');
  const people = c.people === 1 ? `1 person (${c.topPeople[0]})` : `${formatCount(c.people)} people, mostly ${c.topPeople[0]}`;
  return `${apps} · ${people}`;
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function CauseCard({ cause, canEditRules }: { cause: Cause; canEditRules: boolean }) {
  const ev = cause.latest.evidence;
  return (
    <Panel as="article" className="px-6 py-[22px] flex flex-wrap gap-x-6 gap-y-4 items-start">
      <div className="w-[110px] text-[44px] font-extrabold tracking-[-0.03em] leading-none text-stop">{formatCount(cause.count)}</div>

      <div className="flex-[999_1_420px] min-w-0 flex flex-col gap-2.5">
        <h2 className="m-0 text-[22px] leading-[1.2] font-bold tracking-[-0.015em]">{cause.reason}</h2>
        <p className="m-0 text-ink-muted">{whoLine(cause)}</p>
        <div className="bg-canvas border border-line-subtle rounded-[10px] px-3.5 py-3 font-mono text-[13px] leading-[1.6] text-ink-soft [overflow-wrap:anywhere]">
          <span className="text-ink-muted">{cause.latest.app} → {cause.latest.model} · {when(cause.latest.time)}</span>
          <br />
          {ev ? (
            <>
              {ev.before}
              <mark className="bg-stop-soft text-stop-text font-bold px-1 rounded">{ev.hit}</mark>
              {ev.after}
            </>
          ) : (
            <span className="text-ink-muted">No excerpt kept for these requests (they were stopped before excerpts were recorded).</span>
          )}
        </div>
      </div>

      <div className="flex-[1_1_200px] flex flex-col gap-2">
        <span className="text-xs text-ink-muted">Check 1 · Policy rules{cause.ruleType && RULE_KIND[cause.ruleType] ? ` · ${RULE_KIND[cause.ruleType]}` : ''}</span>
        {canEditRules && <ButtonLink to="/rules" variant="secondary" className="self-start mt-1.5">Adjust rule</ButtonLink>}
        <ArrowLink to={`/evidence?outcome=stopped&q=${encodeURIComponent(cause.reason)}`} className="self-start">See all {formatCount(cause.count)}</ArrowLink>
      </div>
    </Panel>
  );
}

export function StoppedPage() {
  const { user, isAdmin } = useAuth();
  const [range, setRange] = useState<RangeKey>('week');
  const [filter, setFilter] = useState<Filter>('all');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['gateway-stopped', user?.tenantId, range],
    queryFn: () => fetchStopped(range),
    refetchInterval: 30_000,
  });

  const causes = data ? data.causes.filter((c) => filter === 'all' || c.check === filter) : [];
  const inline = RANGE_LABELS[range].inline;

  return (
    <div className="flex flex-col gap-7 max-w-[1280px]">
      <div className="flex flex-wrap justify-between items-end gap-6">
        <div>
          <h1 className="m-0 text-[40px] leading-[1.1] font-bold tracking-[-0.025em]">
            {!data ? 'Stopped' : data.total === 0 ? `Nothing was stopped ${inline}` : (
              <><span className="text-stop">{formatCount(data.total)}</span> {data.total === 1 ? 'request' : 'requests'} stopped {inline}</>
            )}
          </h1>
          <p className="m-0 mt-2 text-ink-muted text-base">Grouped by why they were stopped. None of these reached an AI provider.</p>
        </div>
        <div className="flex items-end gap-6 flex-wrap">
          {data && <DayBars days={data.byDay} />}
          <Segmented label="Time range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
        </div>
      </div>

      {data && data.total > 0 && (
        <div role="group" aria-label="Filter by check" className="flex flex-wrap gap-2">
          {([
            { value: 'all', label: `All stopped · ${formatCount(data.total)}` },
            { value: 'policy', label: `Policy rules · ${formatCount(data.byCheck.policy)}` },
          ] as Array<{ value: Filter; label: string }>).map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={clsx(
                'min-h-[40px] px-3.5 rounded-full border',
                filter === f.value ? 'bg-ink text-white border-ink font-semibold' : 'bg-white text-ink border-line-strong'
              )}
            >
              {f.label}
            </button>
          ))}
          <button type="button" disabled className="min-h-[40px] px-3.5 rounded-full border border-dashed border-line-strong text-ink-muted bg-white cursor-not-allowed">
            Secrets · not active yet
          </button>
        </div>
      )}

      {isError && (
        <Panel className="px-6">
          <Note title="Couldn’t load stopped requests.">
            <button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button>
          </Note>
        </Panel>
      )}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}

      {data && data.total === 0 && (
        <Panel className="px-6">
          <Note title="No requests were stopped in this range.">
            When a policy rule stops a request, it appears here grouped by the rule, with the text that triggered it.
          </Note>
        </Panel>
      )}

      {data && causes.length > 0 && (
        <div className="flex flex-col gap-4">
          {causes.map((c) => <CauseCard key={c.key} cause={c} canEditRules={isAdmin} />)}
        </div>
      )}

      {data?.truncated && (
        <p className="m-0 text-xs text-ink-muted">This range has more activity than shown; counts are a lower bound.</p>
      )}
    </div>
  );
}
