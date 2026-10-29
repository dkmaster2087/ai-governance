import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { fetchCostDailyBreakdown, fetchCostSummary } from '../lib/api';
import { Note, Panel, SectionLabel, Segmented } from '../components/aegis/primitives';

type Period = '7d' | '30d' | '90d';
const PERIODS: Array<{ value: Period; label: string }> = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];
const PHRASE: Record<Period, string> = { '7d': 'in the last 7 days', '30d': 'in the last 30 days', '90d': 'in the last 90 days' };

interface Row { name: string; cost: number; requests: number }
interface Summary {
  totalCost: number;
  dailyAverage: number;
  projectedMonthly: number;
  totalRequests: number;
  costByModel: Array<{ modelId: string; cost: number; requests: number }>;
  costByApp?: Array<{ appId: string; cost: number; requests: number }>;
  costByUser: Array<{ userId: string; cost: number; requests: number }>;
}

const money = (n: number) =>
  n === 0 ? '$0' : n < 0.01 ? 'less than $0.01' : n >= 100 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;

function Breakdown({ title, rows }: { title: string; rows: Row[] }) {
  const max = Math.max(0.0001, ...rows.map((r) => r.cost));
  return (
    <Panel className="px-[22px] py-[18px] flex flex-col">
      <SectionLabel className="mb-2">{title}</SectionLabel>
      {rows.length === 0 ? <p className="m-0 py-3 text-ink-muted">Nothing yet.</p> : rows.slice(0, 8).map((r) => (
        <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-2 border-b border-line-subtle last:border-b-0">
          <span className="font-semibold truncate">{r.name}</span>
          <span className="font-mono text-sm">{money(r.cost)}</span>
          <div className="col-span-2 h-1.5 bg-line-subtle rounded-full"><div className="h-1.5 bg-ink rounded-full" style={{ width: `${(r.cost / max) * 100}%` }} /></div>
          <span className="col-span-2 text-xs text-ink-muted">{r.requests.toLocaleString()} {r.requests === 1 ? 'request' : 'requests'}</span>
        </div>
      ))}
    </Panel>
  );
}

/** Estimated AI spend through the gateway, from token counts and each model's configured prices. */
export function CostPage() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const [period, setPeriod] = useState<Period>('30d');
  const summary = useQuery<Summary>({ queryKey: ['cost-summary', tenantId, period], queryFn: () => fetchCostSummary(tenantId, period), enabled: !!tenantId });
  const daily = useQuery<{ breakdown: Array<{ date: string; cost: number }> }>({
    queryKey: ['cost-daily', tenantId, period], queryFn: () => fetchCostDailyBreakdown(tenantId, period), enabled: !!tenantId,
  });
  const s = summary.data;
  const days = daily.data?.breakdown ?? [];
  const maxDay = Math.max(0.0001, ...days.map((d) => d.cost));

  return (
    <div className="flex flex-col gap-6 max-w-[1200px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <p className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-0.02em]">
            {s ? <>{money(s.totalCost)} spent on AI {PHRASE[period]}.</> : ' '}
          </p>
          {s && s.totalRequests > 0 && (
            <p className="m-0 mt-1.5 text-ink-muted text-[15px]">About {money(s.dailyAverage)} a day, or {money(s.projectedMonthly)} a month at this rate, across {s.totalRequests.toLocaleString()} requests.</p>
          )}
        </div>
        <Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} />
      </div>

      {summary.isError && <Panel className="px-6"><Note title="Couldn’t load spend."><button type="button" className="underline font-semibold" onClick={() => summary.refetch()}>Try again</button></Note></Panel>}
      {summary.isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}
      {s && s.totalRequests === 0 && <Panel className="px-6"><Note title="No AI requests in this period.">Spend appears once apps send requests through the gateway.</Note></Panel>}

      {s && s.totalRequests > 0 && (
        <>
          {days.length > 0 && (
            <Panel className="px-[22px] py-[18px]">
              <SectionLabel className="mb-3">Per day</SectionLabel>
              <div role="img" aria-label={`Daily spend: ${days.map((d) => `${d.date} ${money(d.cost)}`).join(', ')}`} className="flex items-end gap-1 h-[120px] border-b border-line">
                {days.map((d) => (
                  <div key={d.date} title={`${d.date}: ${money(d.cost)}`} className="flex-1 bg-ink rounded-t-[2px] min-w-[3px]" style={{ height: `${Math.max(2, (d.cost / maxDay) * 116)}px` }} />
                ))}
              </div>
              <div className="flex justify-between text-xs text-ink-muted mt-1.5"><span>{days[0]?.date}</span><span>{days[days.length - 1]?.date}</span></div>
            </Panel>
          )}
          <div className="grid gap-5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            <Breakdown title="By app" rows={(s.costByApp ?? []).map((r) => ({ name: r.appId, cost: r.cost, requests: r.requests }))} />
            <Breakdown title="By model" rows={[...s.costByModel].sort((a, b) => b.cost - a.cost).map((r) => ({ name: r.modelId, cost: r.cost, requests: r.requests }))} />
            <Breakdown title="By person" rows={s.costByUser.map((r) => ({ name: r.userId, cost: r.cost, requests: r.requests }))} />
          </div>
          <p className="m-0 text-xs text-ink-muted">Estimated from token counts and the prices set for each model in Models &amp; keys. Stopped requests cost nothing.</p>
        </>
      )}
    </div>
  );
}
