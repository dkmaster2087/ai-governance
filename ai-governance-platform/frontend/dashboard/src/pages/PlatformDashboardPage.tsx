import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ago, fetchPlatformUsage, listTenants, Tenant, TenantUsage } from '../lib/platform-api';
import { fetchAllLicenses, formatDate, License } from '../lib/license-api';
import { ArrowLink, Note, Panel, SectionLabel, formatCount } from '../components/aegis/primitives';
import { DayBars, PLAN_LABEL, RUNS_LABEL, StatusPill } from '../components/aegis/platform';

const DAY = 86_400_000;

interface Attention { key: string; text: string; tenantId: string }

/** Things a platform admin should act on, most serious first. */
export function needsAttention(tenants: Tenant[], licenses: License[], usage: TenantUsage[] | undefined, now = Date.now()): Attention[] {
  const items: Attention[] = [];
  for (const t of tenants) {
    if (t.status === 'suspended') items.push({ key: `s-${t.tenantId}`, tenantId: t.tenantId, text: `${t.name} is suspended; every request is refused.` });
  }
  for (const t of tenants) {
    if (t.status !== 'suspended' && t.settings?.governanceFailMode === 'open') {
      items.push({ key: `f-${t.tenantId}`, tenantId: t.tenantId, text: `${t.name} lets requests through unchecked when a check is down.` });
    }
  }
  for (const l of licenses) {
    if (l.status !== 'active' || !l.expiresAt) continue;
    const left = new Date(l.expiresAt).getTime() - now;
    if (left < 30 * DAY) items.push({ key: `l-${l.licenseId}`, tenantId: l.tenantId, text: left < 0 ? `${l.tenantName}’s license expired ${formatDate(l.expiresAt)}.` : `${l.tenantName}’s license expires ${formatDate(l.expiresAt)}.` });
  }
  const licensed = new Set(licenses.filter((l) => l.status === 'active').map((l) => l.tenantId));
  for (const t of tenants) {
    if (t.status !== 'suspended' && !licensed.has(t.tenantId)) items.push({ key: `n-${t.tenantId}`, tenantId: t.tenantId, text: `${t.name} has no active license.` });
  }
  if (usage) {
    for (const t of tenants) {
      const u = usage.find((x) => x.tenantId === t.tenantId);
      if (t.status !== 'suspended' && (!u || u.requests === 0)) items.push({ key: `q-${t.tenantId}`, tenantId: t.tenantId, text: `${t.name} sent no requests in 30 days.` });
    }
  }
  return items;
}

/** Platform home: how every tenant's gateway is doing, and what needs a platform admin. */
export function PlatformDashboardPage() {
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: listTenants });
  const usage = useQuery({ queryKey: ['platform-usage', 30], queryFn: () => fetchPlatformUsage(30) });
  const licenses = useQuery({ queryKey: ['licenses'], queryFn: fetchAllLicenses });

  const list = tenants.data ?? [];
  const u = usage.data;
  const byId = new Map((u?.tenants ?? []).map((t) => [t.tenantId, t]));
  const attention = tenants.data && licenses.data ? needsAttention(list, licenses.data, u?.tenants) : null;

  return (
    <div className="flex flex-col gap-6 max-w-[1200px]">
      <div>
        <p className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-0.02em]">
          {tenants.data && u ? <>{formatCount(list.length)} {list.length === 1 ? 'tenant' : 'tenants'} sent {formatCount(u.totals.requests)} AI requests in the last 30 days.</> : ' '}
        </p>
        {u && u.totals.requests > 0 && (
          <p className="m-0 mt-1.5 text-ink-muted text-[15px]">
            <span className="text-stop-text font-semibold">{formatCount(u.totals.stopped)} stopped</span>, {formatCount(u.totals.cleaned)} had personal data removed.
            {u.truncated && ' Some tenants had more traffic than one read covers, so these are lower bounds.'}
          </p>
        )}
      </div>

      {(tenants.isError || usage.isError) && (
        <Panel className="px-6"><Note title="Couldn’t load the platform view."><button type="button" className="underline font-semibold" onClick={() => { tenants.refetch(); usage.refetch(); }}>Try again</button></Note></Panel>
      )}

      {attention && (
        <Panel className="px-6 py-5">
          <SectionLabel className="mb-2">Needs attention</SectionLabel>
          {attention.length === 0 ? <p className="m-0 py-2 text-ink-muted">Nothing right now.</p> : (
            <ul className="m-0 p-0 list-none">
              {attention.map((a) => (
                <li key={a.key} className="flex flex-wrap justify-between gap-3 py-2.5 border-b border-line-subtle last:border-b-0">
                  <span>{a.text}</span>
                  <Link to={`/tenants/${encodeURIComponent(a.tenantId)}`} className="font-semibold text-ink hover:text-stop">Open <span aria-hidden="true">→</span></Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {u && <DayBars days={u.days} label="All tenants, per day" />}

      {tenants.data && (
        <Panel className="overflow-x-auto">
          <div className="flex justify-between items-center px-6 pt-5 pb-2">
            <SectionLabel>Tenants</SectionLabel>
            <ArrowLink to="/tenants">All tenants</ArrowLink>
          </div>
          {list.length === 0 ? <div className="px-6"><Note title="No tenants yet." /></div> : (
            <table className="w-full border-collapse min-w-[760px]">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  {['Tenant', 'Plan', 'Runs', 'Requests (30 days)', 'Stopped', 'Last request', 'Status'].map((h) => <th key={h} className="font-medium px-6 py-2.5">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {list.map((t) => {
                  const tu = byId.get(t.tenantId);
                  return (
                    <tr key={t.tenantId} className="border-t border-line-subtle">
                      <td className="px-6 py-3"><Link to={`/tenants/${encodeURIComponent(t.tenantId)}`} className="font-semibold text-ink hover:text-stop">{t.name}</Link></td>
                      <td className="px-6 py-3">{PLAN_LABEL[t.plan] ?? t.plan}</td>
                      <td className="px-6 py-3">{RUNS_LABEL[t.deploymentMode] ?? t.deploymentMode}</td>
                      <td className="px-6 py-3 font-mono text-sm">{tu ? formatCount(tu.requests) : '—'}</td>
                      <td className="px-6 py-3 font-mono text-sm">{tu ? (tu.stopped ? <span className="text-stop-text font-semibold">{formatCount(tu.stopped)}</span> : '0') : '—'}</td>
                      <td className="px-6 py-3 text-sm">{tu ? ago(tu.lastRequestAt) : '—'}</td>
                      <td className="px-6 py-3"><StatusPill status={t.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      )}
    </div>
  );
}
