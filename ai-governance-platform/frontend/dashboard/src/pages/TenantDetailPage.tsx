import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activateTenant, ago, fetchPlatformUsage, fetchTenantSetup, getTenant, money, suspendTenant } from '../lib/platform-api';
import { fetchTenantLicenses, formatDate } from '../lib/license-api';
import { errorMessage } from '../lib/rules-api';
import { ArrowLink, Button, Note, Panel, SectionLabel, formatCount } from '../components/aegis/primitives';
import { DayBars, PLAN_LABEL, RUNS_LABEL, StatusPill, TenantForm } from '../components/aegis/platform';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 py-2.5 border-b border-line-subtle last:border-b-0">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

const unknown = <span className="text-ink-muted">Couldn’t read</span>;

/** One tenant: who they are, how their gateway is used, what they've set up, and their licenses. */
export function TenantDetailPage() {
  const { tenantId = '' } = useParams();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const tenant = useQuery({ queryKey: ['tenant', tenantId], queryFn: () => getTenant(tenantId), enabled: !!tenantId });
  const usage = useQuery({ queryKey: ['platform-usage', 30, tenantId], queryFn: () => fetchPlatformUsage(30, tenantId), enabled: !!tenantId });
  const setup = useQuery({ queryKey: ['tenant-setup', tenantId], queryFn: () => fetchTenantSetup(tenantId), enabled: !!tenantId });
  const licenses = useQuery({ queryKey: ['tenant-licenses', tenantId], queryFn: () => fetchTenantLicenses(tenantId), enabled: !!tenantId });

  const t = tenant.data;
  const suspended = t?.status === 'suspended';
  const toggle = useMutation({
    mutationFn: () => (suspended ? activateTenant(tenantId) : suspendTenant(tenantId)),
    onSuccess: () => { setConfirm(false); qc.invalidateQueries({ queryKey: ['tenant', tenantId] }); qc.invalidateQueries({ queryKey: ['tenants'] }); },
  });

  if (tenant.isError) {
    return <Panel className="px-6"><Note title="Couldn’t load this tenant."><Link to="/tenants" className="font-semibold text-ink">Back to tenants</Link></Note></Panel>;
  }
  if (!t) return <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>;

  const tu = usage.data?.tenants[0];
  const s = setup.data;

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <Link to="/tenants" className="text-sm text-ink-muted hover:text-ink">← Tenants</Link>
          <p className="m-0 mt-1 text-[30px] leading-[1.15] font-bold tracking-[-0.02em] flex items-center gap-3 flex-wrap">{t.name} <StatusPill status={t.status} /></p>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px]">
            {tu ? <>{formatCount(tu.requests)} requests in the last 30 days{tu.requests ? <>, <span className="text-stop-text font-semibold">{formatCount(tu.stopped)} stopped</span>. Last one {ago(tu.lastRequestAt).toLowerCase()}.</> : '.'}</> : ' '}
          </p>
        </div>
        {!editing && !confirm && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="secondary" onClick={() => setConfirm(true)}>{suspended ? 'Reactivate' : 'Suspend'}</Button>
          </div>
        )}
      </div>

      {confirm && (
        <Panel className="px-6 py-4 flex flex-wrap items-center gap-3">
          <span>{suspended ? `Reactivate ${t.name}? Their apps can use the gateway again at once.` : `Suspend ${t.name}? Every request from their apps is refused at once, and their dashboard stops working.`}</span>
          <Button onClick={() => toggle.mutate()} disabled={toggle.isPending}>{toggle.isPending ? 'Working…' : suspended ? 'Reactivate' : 'Suspend'}</Button>
          <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          {toggle.isError && <p role="alert" className="m-0 w-full text-stop-text font-semibold">{errorMessage(toggle.error)}</p>}
        </Panel>
      )}

      {editing && <TenantForm tenant={t} onDone={() => setEditing(false)} />}

      {usage.data && <DayBars days={usage.data.days} label="Last 30 days" />}

      <div className="grid gap-5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Panel className="px-6 py-5">
          <SectionLabel className="mb-1">Account</SectionLabel>
          <dl className="m-0">
            <Fact label="Tenant ID"><code className="font-mono text-[13px]">{t.tenantId}</code></Fact>
            <Fact label="Admin">{t.adminEmail}</Fact>
            <Fact label="Plan">{PLAN_LABEL[t.plan] ?? t.plan}</Fact>
            <Fact label="Runs">{RUNS_LABEL[t.deploymentMode] ?? t.deploymentMode} · {t.region}</Fact>
            <Fact label="Evidence kept">{t.settings?.auditLogRetentionDays ? `${t.settings.auditLogRetentionDays} days` : '—'}</Fact>
            <Fact label="Customer since">{t.createdAt ? formatDate(t.createdAt) : '—'}</Fact>
          </dl>
        </Panel>

        <Panel className="px-6 py-5">
          <SectionLabel className="mb-1">What they’ve set up</SectionLabel>
          {setup.isLoading ? <p className="m-0 py-2 text-ink-muted">Loading…</p> : (
            <dl className="m-0">
              <Fact label="When a check is down">
                {s?.failMode == null ? unknown : s.failMode === 'open' ? <span className="text-stop-text font-semibold">Let requests through</span> : 'Block requests'}
              </Fact>
              <Fact label="Rules on">{s?.rulesOn == null ? unknown : formatCount(s.rulesOn)}</Fact>
              <Fact label="Models listed">{s?.modelsListed == null ? unknown : formatCount(s.modelsListed)}</Fact>
              <Fact label="Frameworks on">{s?.frameworksOn == null ? unknown : s.frameworksOn.length ? s.frameworksOn.join(', ') : 'None'}</Fact>
              <Fact label="Spend, 30 days">{tu ? money(tu.cost) : '—'}</Fact>
            </dl>
          )}
        </Panel>
      </div>

      {tu && tu.models.length > 0 && (
        <Panel className="px-6 py-5">
          <SectionLabel className="mb-2">Models used, 30 days</SectionLabel>
          <ul className="m-0 p-0 list-none">
            {tu.models.slice(0, 8).map((m) => (
              <li key={m.model} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-6 py-2 border-b border-line-subtle last:border-b-0">
                <span className="font-mono text-[13px] truncate">{m.model}</span>
                <span className="font-mono text-sm">{formatCount(m.requests)}</span>
                <span className="font-mono text-sm text-ink-muted w-20 text-right">{money(m.cost)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel className="px-6 py-5">
        <div className="flex justify-between items-center mb-2">
          <SectionLabel>Licenses</SectionLabel>
          <ArrowLink to="/licenses">Manage licenses</ArrowLink>
        </div>
        {licenses.isError ? <p className="m-0 text-ink-muted">Couldn’t load licenses.</p>
          : !licenses.data ? <p className="m-0 text-ink-muted">Loading…</p>
          : licenses.data.length === 0 ? <p className="m-0 text-ink-muted">None issued.</p> : (
            <ul className="m-0 p-0 list-none">
              {licenses.data.map((l) => (
                <li key={l.licenseId} className="flex flex-wrap justify-between gap-3 py-2.5 border-b border-line-subtle last:border-b-0">
                  <span><span className="font-semibold">{PLAN_LABEL[l.plan] ?? l.plan}</span> <span className="font-mono text-xs text-ink-muted">{l.keyPrefix}</span></span>
                  <span className="text-sm">{l.status === 'active' ? `Valid until ${formatDate(l.expiresAt)}` : <span className="capitalize text-ink-muted">{l.status}</span>}</span>
                </li>
              ))}
            </ul>
          )}
      </Panel>
    </div>
  );
}
