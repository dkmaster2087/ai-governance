import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { fetchTenants } from '../lib/tenant-api';
import { downloadLicenseFile, fetchAllLicenses, fetchLicenseFile, formatDate, issueLicense, License, revokeLicense, STATUS_LABEL } from '../lib/license-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Note, Panel, SectionLabel } from '../components/kit/primitives';

const field = 'min-h-[42px] px-3 border border-line-strong rounded-lg bg-white';

/** Platform admins: every license across tenants. Keys are shown once, when issued. */
export function LicensesPage() {
  const qc = useQueryClient();
  const [issuing, setIssuing] = useState(false);
  const [form, setForm] = useState({ tenantId: '', plan: 'professional', type: 'cloud' as 'cloud' | 'onprem', maxUsers: 50, validityDays: 365, address: '' });
  const [newKey, setNewKey] = useState<{ key: string; tenantName: string; file?: boolean; licenseId: string; addresses?: string[] } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: licenses, isLoading, isError, refetch } = useQuery({ queryKey: ['licenses'], queryFn: fetchAllLicenses });
  const { data: tenants = [] } = useQuery({ queryKey: ['tenants'], queryFn: () => fetchTenants() });
  const refresh = () => qc.invalidateQueries({ queryKey: ['licenses'] });
  const issue = useMutation({
    mutationFn: () => issueLicense(form.tenantId, {
      plan: form.plan, type: form.type, maxUsers: form.maxUsers, validityDays: form.validityDays,
      ...(form.type === 'onprem' ? { addresses: form.address.split(',').map((a) => a.trim()).filter(Boolean) } : {}),
    }),
    onSuccess: (r) => {
      setNewKey({ key: r.licenseFile ?? r.licenseKey ?? '', tenantName: r.tenantName, file: !!r.licenseFile, licenseId: r.licenseId, addresses: r.addresses });
      setCopied(false); setIssuing(false); refresh();
    },
  });
  const [revoking, setRevoking] = useState<string | null>(null);
  const revoke = useMutation({
    mutationFn: ({ l, graceDays }: { l: License; graceDays: number }) => revokeLicense(l.tenantId, l.licenseId, graceDays),
    onSuccess: () => { setRevoking(null); refresh(); },
  });

  const active = licenses?.filter((l) => l.status === 'active').length ?? 0;

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <p className="m-0 text-ink-muted text-[15px]">{licenses ? `${active} active ${active === 1 ? 'license' : 'licenses'} across ${tenants.length} ${tenants.length === 1 ? 'tenant' : 'tenants'}.` : ''}</p>
        {!issuing && <Button onClick={() => setIssuing(true)}>Issue a license</Button>}
      </div>

      {newKey && (
        <Panel className="px-6 py-5 border-2 border-ink flex flex-col gap-3">
          {newKey.file ? (
            <>
              <p className="m-0 font-semibold">License file for {newKey.tenantName}, for {newKey.addresses?.join(' and ')}.</p>
              <p className="m-0 text-sm text-ink-muted">
                Send it to {newKey.tenantName}. They enter it on their gateway’s License page, or set it as PROBALINE_LICENSE when installing.
                Their gateway checks it by itself and serves only {newKey.addresses?.length === 1 ? 'that address' : 'those addresses'}. You can download it again from the list below.
              </p>
            </>
          ) : (
            <>
              <p className="m-0 font-semibold">License key for {newKey.tenantName}. Copy it now; it won’t be shown again.</p>
              <p className="m-0 text-sm text-ink-muted">Send it to {newKey.tenantName}. It counts once one of their admins enters it on their License page.</p>
            </>
          )}
          <code className="block bg-canvas border border-line-subtle rounded-lg px-3.5 py-3 font-mono text-[13px] [overflow-wrap:anywhere] max-h-[160px] overflow-y-auto">{newKey.key}</code>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={async () => { try { await navigator.clipboard.writeText(newKey.key); setCopied(true); } catch { /* unavailable */ } }}>{copied ? 'Copied' : newKey.file ? 'Copy license file' : 'Copy key'}</Button>
            {newKey.file && <Button variant="secondary" onClick={() => downloadLicenseFile(newKey.key, newKey.licenseId)}>Download</Button>}
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
                <option value="cloud">Hosted by us</option><option value="onprem">On their own infrastructure</option>
              </select>
            </label>
            {form.type === 'onprem' && (
              <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Gateway address</span>
                <input className={field} value={form.address} placeholder="ai-gateway.customer.com" required
                  onChange={(e) => setForm({ ...form, address: e.target.value })} />
                <span className="text-xs text-ink-muted">Their gateway will serve only this address. For one gateway with two names, separate them with a comma.</span>
              </label>
            )}
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
                {['Tenant', 'Plan', 'Runs', 'Users', 'Valid until', 'Status', ''].map((h) => <th key={h} className="font-medium px-4 py-3">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {licenses.map((l) => (
                <tr key={l.licenseId} className="border-t border-line-subtle">
                  <td className="px-4 py-3"><div className="font-semibold">{l.tenantName}</div><div className="font-mono text-xs text-ink-muted">{l.keyPrefix}</div></td>
                  <td className="px-4 py-3 capitalize">{l.plan}</td>
                  <td className="px-4 py-3">{l.file ? <>Their own<div className="font-mono text-xs text-ink-muted">{l.addresses?.join(', ')}</div></> : 'Hosted'}</td>
                  <td className="px-4 py-3">{l.maxUsers > 0 ? l.maxUsers.toLocaleString() : "—"}</td>
                  <td className="px-4 py-3">{formatDate(l.expiresAt)}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap', l.status === 'active' ? 'bg-ink-tint text-ink' : 'bg-line-subtle text-ink-soft')}>{STATUS_LABEL[l.status]}</span>
                    {l.status === 'revoked' && l.graceUntil && Date.parse(l.graceUntil) > Date.now() && <div className="text-xs text-ink-muted mt-1">Works until {formatDate(l.graceUntil)}</div>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {l.file && <Button variant="secondary" onClick={async () => downloadLicenseFile(await fetchLicenseFile(l.tenantId, l.licenseId), l.licenseId)}>Download file</Button>}
                    {!l.file && (l.status === 'active' || l.status === 'pending') && revoking !== l.licenseId && <Button variant="secondary" onClick={() => setRevoking(l.licenseId)}>Revoke</Button>}
                    {revoking === l.licenseId && (
                      <div className="flex flex-col items-end gap-1.5" role="group" aria-label={`Revoke ${l.tenantName}'s license`}>
                        <Button disabled={revoke.isPending} onClick={() => revoke.mutate({ l, graceDays: 30 })}>Revoke, 30 days to renew</Button>
                        <Button variant="secondary" disabled={revoke.isPending} onClick={() => { if (window.confirm(`Stop ${l.tenantName}'s AI requests now?`)) revoke.mutate({ l, graceDays: 0 }); }}>Revoke and stop now</Button>
                        <button type="button" className="text-sm underline text-ink-muted" onClick={() => setRevoking(null)}>Cancel</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
