import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { fetchTenants } from '../lib/tenant-api';
import { fetchAllLicenses, formatDate, issueLicense, License, revokeLicense } from '../lib/license-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Note, Panel, SectionLabel } from '../components/aegis/primitives';

const field = 'min-h-[42px] px-3 border border-line-strong rounded-lg bg-white';

/** Platform admins: every license across tenants. Keys are shown once, when issued. */
export function LicensesPage() {
  const qc = useQueryClient();
  const [issuing, setIssuing] = useState(false);
  const [form, setForm] = useState({ tenantId: '', plan: 'professional', type: 'cloud' as 'cloud' | 'onprem', maxUsers: 50, validityDays: 365 });
  const [newKey, setNewKey] = useState<{ key: string; tenantName: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: licenses, isLoading, isError, refetch } = useQuery({ queryKey: ['licenses'], queryFn: fetchAllLicenses });
  const { data: tenants = [] } = useQuery({ queryKey: ['tenants'], queryFn: () => fetchTenants() });
  const refresh = () => qc.invalidateQueries({ queryKey: ['licenses'] });
  const issue = useMutation({
    mutationFn: () => issueLicense(form.tenantId, form),
    onSuccess: (r) => { setNewKey({ key: r.licenseKey, tenantName: r.tenantName }); setCopied(false); setIssuing(false); refresh(); },
  });
  const revoke = useMutation({ mutationFn: (l: License) => revokeLicense(l.tenantId, l.licenseId), onSuccess: refresh });

  const active = licenses?.filter((l) => l.status === 'active').length ?? 0;

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <p className="m-0 text-ink-muted text-[15px]">{licenses ? `${active} active ${active === 1 ? 'license' : 'licenses'} across ${tenants.length} tenants.` : ''}</p>
        {!issuing && <Button onClick={() => setIssuing(true)}>Issue a license</Button>}
      </div>

      {newKey && (
        <Panel className="px-6 py-5 border-2 border-ink flex flex-col gap-3">
          <p className="m-0 font-semibold">License key for {newKey.tenantName}. Copy it now; it won’t be shown again.</p>
          <code className="block bg-canvas border border-line-subtle rounded-lg px-3.5 py-3 font-mono text-[13px] [overflow-wrap:anywhere]">{newKey.key}</code>
          <div className="flex gap-2">
            <Button onClick={async () => { try { await navigator.clipboard.writeText(newKey.key); setCopied(true); } catch { /* unavailable */ } }}>{copied ? 'Copied' : 'Copy key'}</Button>
            <Button variant="secondary" onClick={() => setNewKey(null)}>Done</Button>
          </div>
        </Panel>
      )}

      {issuing && (
        <Panel aria-label="Issue a license" className="px-6 py-5">
          <SectionLabel className="mb-3">Issue a license</SectionLabel>
          <form className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
            onSubmit={(e) => { e.preventDefault(); if (form.tenantId) issue.mutate(); }}>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Tenant</span>
              <select className={field} value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} required>
                <option value="">Choose…</option>
                {tenants.map((t: { tenantId: string; name: string }) => <option key={t.tenantId} value={t.tenantId}>{t.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Plan</span>
              <select className={field} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                <option value="starter">Starter</option><option value="professional">Professional</option><option value="enterprise">Enterprise</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Runs</span>
              <select className={field} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'cloud' | 'onprem' })}>
                <option value="cloud">Hosted</option><option value="onprem">In their AWS account</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Users included</span>
              <input className={field} type="number" min={1} value={form.maxUsers} onChange={(e) => setForm({ ...form, maxUsers: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Valid for</span>
              <select className={field} value={form.validityDays} onChange={(e) => setForm({ ...form, validityDays: Number(e.target.value) })}>
                <option value={30}>30 days (trial)</option><option value={365}>1 year</option><option value={730}>2 years</option><option value={1095}>3 years</option>
              </select>
            </label>
            <div className="flex items-end gap-2">
              <Button type="submit" disabled={!form.tenantId || issue.isPending}>{issue.isPending ? 'Issuing…' : 'Issue'}</Button>
              <Button type="button" variant="secondary" onClick={() => setIssuing(false)}>Cancel</Button>
            </div>
            {issue.isError && <p role="alert" className="m-0 text-stop-text font-semibold col-span-full">{errorMessage(issue.error)}</p>}
          </form>
        </Panel>
      )}

      {isError && <Panel className="px-6"><Note title="Couldn’t load licenses."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}
      {licenses && licenses.length === 0 && <Panel className="px-6"><Note title="No licenses issued yet." /></Panel>}
      {licenses && licenses.length > 0 && (
        <Panel className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[760px]">
            <thead>
              <tr className="text-left text-xs text-ink-muted">
                {['Tenant', 'Plan', 'Runs', 'Users', 'Valid until', 'Last report', 'Status', ''].map((h) => <th key={h} className="font-medium px-4 py-3">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {licenses.map((l) => (
                <tr key={l.licenseId} className="border-t border-line-subtle">
                  <td className="px-4 py-3"><div className="font-semibold">{l.tenantName}</div><div className="font-mono text-xs text-ink-muted">{l.keyPrefix}</div></td>
                  <td className="px-4 py-3 capitalize">{l.plan}</td>
                  <td className="px-4 py-3">{l.type === 'onprem' ? 'Their AWS' : 'Hosted'}</td>
                  <td className="px-4 py-3">{l.maxUsers > 0 ? l.maxUsers.toLocaleString() : "—"}</td>
                  <td className="px-4 py-3">{formatDate(l.expiresAt)}</td>
                  <td className="px-4 py-3">{formatDate(l.lastUsedAt)}</td>
                  <td className="px-4 py-3"><span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', l.status === 'active' ? 'bg-ink-tint text-ink' : 'bg-line-subtle text-ink-soft')}>{l.status}</span></td>
                  <td className="px-4 py-3 text-right">{l.status === 'active' && <Button variant="secondary" disabled={revoke.isPending} onClick={() => revoke.mutate(l)}>Revoke</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
