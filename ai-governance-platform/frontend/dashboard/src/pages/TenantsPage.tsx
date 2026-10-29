import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ago, fetchPlatformUsage, listTenants, Tenant } from '../lib/platform-api';
import { usersManagedExternally } from '../lib/auth';
import { Button, ButtonLink, Note, Panel, SectionLabel, formatCount } from '../components/aegis/primitives';
import { PLAN_LABEL, RUNS_LABEL, StatusPill, TenantForm } from '../components/aegis/platform';

/** What to do after a tenant exists: give their admin a way in, and a license. */
export function NextSteps({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const pool = import.meta.env.VITE_COGNITO_USER_POOL_ID || '<user-pool-id>';
  const command = [
    `aws cognito-idp admin-create-user \\`,
    `  --user-pool-id ${pool} \\`,
    `  --username ${tenant.adminEmail} \\`,
    `  --user-attributes Name=email,Value=${tenant.adminEmail} Name=email_verified,Value=true \\`,
    `    Name=custom:tenantId,Value=${tenant.tenantId} Name=custom:role,Value=tenant_admin`,
  ].join('\n');
  return (
    <Panel className="px-6 py-5 border-2 border-ink flex flex-col gap-3">
      <p className="m-0 font-semibold">{tenant.name} is set up. Tenant ID <code className="font-mono">{tenant.tenantId}</code>.</p>
      {usersManagedExternally ? (
        <>
          <p className="m-0 text-ink-soft">Next, create their admin in Cognito. They’ll get an email with a temporary password.</p>
          <pre className="m-0 bg-canvas border border-line-subtle rounded-lg px-4 py-3 font-mono text-[12.5px] whitespace-pre-wrap [overflow-wrap:anywhere]">{command}</pre>
        </>
      ) : (
        <p className="m-0 text-ink-soft">Their admin can sign in locally as {tenant.adminEmail}.</p>
      )}
      <div className="flex gap-2 flex-wrap">
        <ButtonLink to="/licenses">Issue a license</ButtonLink>
        <Button variant="secondary" onClick={onClose}>Done</Button>
      </div>
    </Panel>
  );
}

/** Every customer on the platform. */
export function TenantsPage() {
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<Tenant | null>(null);
  const [search, setSearch] = useState('');
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: listTenants });
  const usage = useQuery({ queryKey: ['platform-usage', 30], queryFn: () => fetchPlatformUsage(30) });
  const byId = new Map((usage.data?.tenants ?? []).map((t) => [t.tenantId, t]));

  const list = tenants.data ?? [];
  const q = search.trim().toLowerCase();
  const shown = q ? list.filter((t) => t.name.toLowerCase().includes(q) || t.adminEmail.toLowerCase().includes(q) || t.tenantId.includes(q)) : list;
  const suspended = list.filter((t) => t.status === 'suspended').length;

  return (
    <div className="flex flex-col gap-6 max-w-[1200px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <p className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-0.02em]">{tenants.data ? `${formatCount(list.length)} ${list.length === 1 ? 'tenant' : 'tenants'}.` : ' '}</p>
          {tenants.data && <p className="m-0 mt-1.5 text-ink-muted text-[15px]">{suspended ? `${suspended} suspended.` : 'None suspended.'}</p>}
        </div>
        {!adding && <Button onClick={() => { setAdding(true); setCreated(null); }}>Add a tenant</Button>}
      </div>

      {adding && <TenantForm onDone={(t) => { setAdding(false); if (t) setCreated(t); }} />}
      {created && <NextSteps tenant={created} onClose={() => setCreated(null)} />}

      {tenants.isError && <Panel className="px-6"><Note title="Couldn’t load tenants."><button type="button" className="underline font-semibold" onClick={() => tenants.refetch()}>Try again</button></Note></Panel>}
      {tenants.isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}

      {tenants.data && (
        <Panel className="overflow-x-auto">
          <div className="flex flex-wrap justify-between items-center gap-3 px-6 pt-5 pb-2">
            <SectionLabel>All tenants</SectionLabel>
            <input type="search" aria-label="Search tenants" placeholder="Search name, email or ID" value={search} onChange={(e) => setSearch(e.target.value)}
              className="min-h-[38px] px-3 border border-line-strong rounded-lg bg-white w-[260px] max-w-full" />
          </div>
          {shown.length === 0 ? <div className="px-6"><Note title={list.length ? 'No tenants match.' : 'No tenants yet.'} /></div> : (
            <table className="w-full border-collapse min-w-[860px]">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  {['Tenant', 'Admin', 'Plan', 'Runs', 'Requests (30 days)', 'Last request', 'Since', 'Status'].map((h) => <th key={h} className="font-medium px-6 py-2.5">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const tu = byId.get(t.tenantId);
                  return (
                    <tr key={t.tenantId} className="border-t border-line-subtle">
                      <td className="px-6 py-3">
                        <Link to={`/tenants/${encodeURIComponent(t.tenantId)}`} className="font-semibold text-ink hover:text-stop">{t.name}</Link>
                        <div className="font-mono text-xs text-ink-muted">{t.tenantId}</div>
                      </td>
                      <td className="px-6 py-3 text-sm">{t.adminEmail}</td>
                      <td className="px-6 py-3">{PLAN_LABEL[t.plan] ?? t.plan}</td>
                      <td className="px-6 py-3">{RUNS_LABEL[t.deploymentMode] ?? t.deploymentMode}</td>
                      <td className="px-6 py-3 font-mono text-sm">{tu ? formatCount(tu.requests) : '—'}</td>
                      <td className="px-6 py-3 text-sm">{tu ? ago(tu.lastRequestAt) : '—'}</td>
                      <td className="px-6 py-3 text-sm">{t.createdAt ? new Date(t.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—'}</td>
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
