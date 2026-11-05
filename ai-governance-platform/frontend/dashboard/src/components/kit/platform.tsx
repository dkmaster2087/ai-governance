/** Pieces shared by the platform-admin pages. */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTenant, Tenant, TenantInput, updateTenant } from '../../lib/platform-api';
import { registerTenantAccount, usersManagedExternally } from '../../lib/auth';
import { errorMessage } from '../../lib/rules-api';
import { Button, Panel, SectionLabel } from './primitives';

/** Requests per day, with the stopped share in red. */
export function DayBars({ days, label = 'Per day' }: { days: Array<{ date: string; requests: number; stopped: number }>; label?: string }) {
  const max = Math.max(1, ...days.map((d) => d.requests));
  const total = days.reduce((s, d) => s + d.requests, 0);
  return (
    <Panel className="px-[22px] py-[18px]">
      <div className="flex flex-wrap justify-between gap-2 mb-3">
        <SectionLabel>{label}</SectionLabel>
        <span className="text-xs text-ink-muted"><span className="inline-block w-2.5 h-2.5 bg-ink rounded-sm mr-1 align-middle" />Requests <span className="inline-block w-2.5 h-2.5 bg-stop rounded-sm ml-3 mr-1 align-middle" />Stopped</span>
      </div>
      {total === 0 ? <p className="m-0 py-6 text-ink-muted">No requests in this period.</p> : (
        <>
          <div role="img" aria-label={`Requests per day: ${days.map((d) => `${d.date} ${d.requests} (${d.stopped} stopped)`).join(', ')}`}
            className="flex items-end gap-[3px] h-[120px] border-b border-line">
            {days.map((d) => {
              const h = (d.requests / max) * 116;
              const stoppedH = d.requests ? (d.stopped / d.requests) * h : 0;
              return (
                <div key={d.date} title={`${d.date}: ${d.requests} requests, ${d.stopped} stopped`} className="flex-1 min-w-[2px] flex flex-col justify-end" style={{ height: '116px' }}>
                  {d.requests > 0 && <div className="bg-stop rounded-t-[2px]" style={{ height: `${stoppedH}px` }} />}
                  <div className={d.stopped ? 'bg-ink' : 'bg-ink rounded-t-[2px]'} style={{ height: `${Math.max(d.requests ? 2 : 0, h - stoppedH)}px` }} />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-ink-muted mt-1.5"><span>{days[0]?.date}</span><span>{days[days.length - 1]?.date}</span></div>
        </>
      )}
    </Panel>
  );
}

export const PLAN_LABEL: Record<string, string> = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' };
export const RUNS_LABEL: Record<string, string> = { saas: 'Hosted', onprem: 'Their AWS' };

export function StatusPill({ status }: { status: string }) {
  const suspended = status === 'suspended';
  return (
    <span className={suspended ? 'text-xs font-semibold px-2 py-0.5 rounded-full bg-stop-soft text-stop-text' : 'text-xs font-semibold px-2 py-0.5 rounded-full bg-ink-tint text-ink'}>
      {suspended ? 'Suspended' : status === 'trial' ? 'Trial' : 'Active'}
    </span>
  );
}

const field = 'w-full min-h-[42px] px-3 border border-line-strong rounded-lg bg-white';
const REGIONS = ['us-east-1', 'us-west-2', 'ca-central-1', 'eu-west-1', 'eu-central-1', 'ap-southeast-1'];

/** Add a tenant, or change one. */
export function TenantForm({ tenant, onDone }: { tenant?: Tenant; onDone: (created?: Tenant) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<TenantInput>({
    name: tenant?.name ?? '',
    adminEmail: tenant?.adminEmail ?? '',
    plan: tenant?.plan ?? 'professional',
    deploymentMode: tenant?.deploymentMode ?? 'saas',
    region: tenant?.region ?? 'us-east-1',
    auditLogRetentionDays: tenant?.settings?.auditLogRetentionDays ?? 365,
  });
  const [password, setPassword] = useState('');
  const set = <K extends keyof TenantInput>(k: K, v: TenantInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => (tenant ? (await updateTenant(tenant.tenantId, form), undefined) : createTenant(form)),
    onSuccess: (created) => {
      if (created && !usersManagedExternally) {
        registerTenantAccount({ email: form.adminEmail, password: password || 'welcome123', name: `${form.name} Admin`, role: 'tenant_admin', tenantId: created.tenantId, tenantName: form.name });
      }
      qc.invalidateQueries({ queryKey: ['tenants'] });
      qc.invalidateQueries({ queryKey: ['tenant'] });
      onDone(created ?? undefined);
    },
  });
  const valid = form.name.trim() && /\S+@\S+\.\S+/.test(form.adminEmail);

  return (
    <Panel aria-label={tenant ? `Edit ${tenant.name}` : 'Add a tenant'} className="px-6 py-5">
      <SectionLabel className="mb-3">{tenant ? `Edit ${tenant.name}` : 'Add a tenant'}</SectionLabel>
      <form className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
        onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
        <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Company</span>
          <input className={field} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Acme Corp" />
        </label>
        <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Admin email</span>
          <input className={field} type="email" value={form.adminEmail} onChange={(e) => set('adminEmail', e.target.value)} placeholder="security@acme.com" />
        </label>
        {!tenant && !usersManagedExternally && (
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Admin password (local demo)</span>
            <input className={field} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Default: welcome123" />
          </label>
        )}
        <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Plan</span>
          <select className={field} value={form.plan} onChange={(e) => set('plan', e.target.value as TenantInput['plan'])}>
            {Object.entries(PLAN_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Runs</span>
          <select className={field} value={form.deploymentMode} onChange={(e) => set('deploymentMode', e.target.value as TenantInput['deploymentMode'])}>
            <option value="saas">Hosted by us</option><option value="onprem">In their AWS account</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">AWS region</span>
          <select className={field} value={form.region} onChange={(e) => set('region', e.target.value)}>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Keep evidence for</span>
          <select className={field} value={form.auditLogRetentionDays} onChange={(e) => set('auditLogRetentionDays', Number(e.target.value))}>
            {[90, 365, 730, 2555].map((d) => <option key={d} value={d}>{d === 2555 ? '7 years' : d >= 365 ? `${d / 365} year${d > 365 ? 's' : ''}` : `${d} days`}</option>)}
          </select>
        </label>
        {save.isError && <p role="alert" className="m-0 text-stop-text font-semibold col-span-full">{errorMessage(save.error)}</p>}
        <div className="flex gap-2 col-span-full">
          <Button type="submit" disabled={!valid || save.isPending}>{save.isPending ? 'Saving…' : tenant ? 'Save' : 'Add tenant'}</Button>
          <Button type="button" variant="secondary" onClick={() => onDone()}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}
