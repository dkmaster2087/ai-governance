import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Days, fetchPlatformUsage, listTenants, money } from '../lib/platform-api';
import { Note, Panel, SectionLabel, Segmented, formatCount } from '../components/aegis/primitives';
import { DayBars } from '../components/aegis/platform';

const PERIODS: Array<{ value: '7' | '30' | '90'; label: string }> = [
  { value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' },
];

/** AI traffic and estimated spend across tenants, from the audit log. */
export function AnalyticsPage() {
  const [period, setPeriod] = useState<'7' | '30' | '90'>('30');
  const [tenantId, setTenantId] = useState('');
  const days = Number(period) as Days;
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: listTenants });
  const usage = useQuery({ queryKey: ['platform-usage', days, tenantId], queryFn: () => fetchPlatformUsage(days, tenantId || undefined) });
  const names = new Map((tenants.data ?? []).map((t) => [t.tenantId, t.name]));
  const u = usage.data;

  const models = new Map<string, { requests: number; cost: number }>();
  for (const t of u?.tenants ?? []) for (const m of t.models) {
    const cur = models.get(m.model) ?? { requests: 0, cost: 0 };
    models.set(m.model, { requests: cur.requests + m.requests, cost: cur.cost + m.cost });
  }
  const modelRows = [...models.entries()].sort((a, b) => b[1].requests - a[1].requests).slice(0, 10);
  const maxModel = Math.max(1, ...modelRows.map(([, v]) => v.requests));
  const who = tenantId ? names.get(tenantId) ?? tenantId : 'All tenants';

  return (
    <div className="flex flex-col gap-6 max-w-[1200px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <p className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-0.02em]">
            {u ? <>{formatCount(u.totals.requests)} requests in the last {days} days.</> : ' '}
          </p>
          {u && (
            <p className="m-0 mt-1.5 text-ink-muted text-[15px]">
              {who}. <span className="text-stop-text font-semibold">{formatCount(u.totals.stopped)} stopped</span>, {formatCount(u.totals.cleaned)} cleaned, about {money(u.totals.cost)} in model spend.
              {u.truncated && ' Lower bounds: some tenants had more traffic than one read covers.'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <select aria-label="Tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="min-h-[38px] px-3 border border-line-strong rounded-lg bg-white">
            <option value="">All tenants</option>
            {(tenants.data ?? []).map((t) => <option key={t.tenantId} value={t.tenantId}>{t.name}</option>)}
          </select>
          <Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} />
        </div>
      </div>

      {usage.isError && <Panel className="px-6"><Note title="Couldn’t load usage."><button type="button" className="underline font-semibold" onClick={() => usage.refetch()}>Try again</button></Note></Panel>}
      {usage.isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}

      {u && <DayBars days={u.days} />}

      {u && u.totals.requests > 0 && (
        <div className="grid gap-5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          {!tenantId && (
            <Panel className="overflow-x-auto">
              <div className="px-6 pt-5 pb-1"><SectionLabel>By tenant</SectionLabel></div>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-left text-xs text-ink-muted">{['Tenant', 'Requests', 'Stopped', 'Spend'].map((h) => <th key={h} className="font-medium px-6 py-2">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {u.tenants.filter((t) => t.requests > 0).map((t) => (
                    <tr key={t.tenantId} className="border-t border-line-subtle">
                      <td className="px-6 py-2.5"><Link to={`/tenants/${encodeURIComponent(t.tenantId)}`} className="font-semibold text-ink hover:text-stop">{names.get(t.tenantId) ?? t.tenantId}</Link></td>
                      <td className="px-6 py-2.5 font-mono text-sm">{formatCount(t.requests)}</td>
                      <td className="px-6 py-2.5 font-mono text-sm">{t.stopped ? <span className="text-stop-text font-semibold">{formatCount(t.stopped)}</span> : '0'}</td>
                      <td className="px-6 py-2.5 font-mono text-sm">{money(t.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
          <Panel className="px-6 py-5">
            <SectionLabel className="mb-2">By model</SectionLabel>
            {modelRows.map(([model, v]) => (
              <div key={model} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-2 border-b border-line-subtle last:border-b-0">
                <span className="font-mono text-[13px] truncate">{model}</span>
                <span className="font-mono text-sm">{formatCount(v.requests)}</span>
                <div className="col-span-2 h-1.5 bg-line-subtle rounded-full"><div className="h-1.5 bg-ink rounded-full" style={{ width: `${(v.requests / maxModel) * 100}%` }} /></div>
                <span className="col-span-2 text-xs text-ink-muted">{money(v.cost)} estimated</span>
              </div>
            ))}
          </Panel>
        </div>
      )}
      {u && <p className="m-0 text-xs text-ink-muted">Spend is estimated from token counts and the prices each tenant set for its models.</p>}
    </div>
  );
}
