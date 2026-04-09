import { useState } from 'react';
import { Key, Plus, Copy, Check, Building2, AlertTriangle, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';
import { getLicenseList, generateLicenseKey, storeTenantLicense, type TenantLicense } from '../lib/license';

const mockLicenses: TenantLicense[] = [
  { tenantName: 'Demo Corp', tenantId: 'tenant_demo', licenseKey: 'AEGIS-DEMO-XXXX-XXXX', type: 'cloud', plan: 'professional', status: 'active', issuedAt: '2026-01-01', expiresAt: '2027-01-01', maxUsers: 50, currentUsers: 45, reportingConfig: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: true } },
  { tenantName: 'HealthCo Systems', tenantId: 'tenant_healthco', licenseKey: 'AEGIS-HC01-XXXX-XXXX', type: 'onprem', plan: 'enterprise', status: 'active', issuedAt: '2026-01-15', expiresAt: '2027-01-15', maxUsers: 200, currentUsers: 120, reportingConfig: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: false } },
  { tenantName: 'FinTech Inc', tenantId: 'tenant_fintech', licenseKey: 'AEGIS-FT01-XXXX-XXXX', type: 'cloud', plan: 'enterprise', status: 'active', issuedAt: '2026-02-01', expiresAt: '2027-02-01', maxUsers: 100, currentUsers: 38, reportingConfig: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: true } },
  { tenantName: 'RetailMax', tenantId: 'tenant_retail', licenseKey: 'AEGIS-RM01-XXXX-XXXX', type: 'onprem', plan: 'professional', status: 'trial', issuedAt: '2026-03-20', expiresAt: '2026-04-20', maxUsers: 50, currentUsers: 32, reportingConfig: { usageMetrics: false, costData: false, complianceStatus: false, auditLogs: false } },
  { tenantName: 'LegalFirm LLP', tenantId: 'tenant_legal', licenseKey: 'AEGIS-LF01-XXXX-XXXX', type: 'cloud', plan: 'starter', status: 'active', issuedAt: '2026-03-01', expiresAt: '2027-03-01', maxUsers: 20, currentUsers: 12, reportingConfig: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: true } },
];

export function LicensesPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const [copied, setCopied] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [newKey, setNewKey] = useState(generateLicenseKey());
  const [genMaxUsers, setGenMaxUsers] = useState(50);
  const [genValidityMonths, setGenValidityMonths] = useState(12);
  const [genTenantName, setGenTenantName] = useState('');
  const [genType, setGenType] = useState<'cloud' | 'onprem'>('cloud');
  const [saved, setSaved] = useState(false);
  const [licenseVersion, setLicenseVersion] = useState(0);

  // Re-read from store whenever licenseVersion bumps
  const freshLicenses = getLicenseList();
  const licenses: TenantLicense[] = freshLicenses.length > 0 || licenseVersion > 0 ? freshLicenses : mockLicenses;

  const handleSaveLicense = () => {
    if (!genTenantName.trim()) return;
    const now = new Date();
    const expiry = new Date(now);
    expiry.setMonth(expiry.getMonth() + genValidityMonths);
    const tenantId = 'tenant_' + genTenantName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    storeTenantLicense({
      licenseKey: newKey,
      tenantId,
      tenantName: genTenantName,
      plan: 'professional',
      type: genType,
      status: 'active',
      maxUsers: genMaxUsers,
      currentUsers: 0,
      issuedAt: now.toISOString().slice(0, 10),
      expiresAt: expiry.toISOString().slice(0, 10),
      reportingConfig: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: genType !== 'onprem' },
    });
    setSaved(true);
    setLicenseVersion((v) => v + 1);
    setTimeout(() => {
      setSaved(false);
      setShowGenerate(false);
      setNewKey(generateLicenseKey());
      setGenTenantName('');
      setGenMaxUsers(50);
      setGenValidityMonths(12);
    }, 1500);
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const statusConfig: Record<string, { color: string; label: string }> = {
    active: { color: 'bg-accent-500/10 text-accent-400 ring-accent-500/20', label: 'Active' },
    trial: { color: 'bg-yellow-500/10 text-yellow-400 ring-yellow-500/20', label: 'Trial' },
    expired: { color: 'bg-red-500/10 text-red-400 ring-red-500/20', label: 'Expired' },
    revoked: { color: 'bg-red-500/10 text-red-400 ring-red-500/20', label: 'Revoked' },
  };

  const activeLicenseCount = licenses.filter((l) => l.status === 'active' || l.status === 'trial').length;
  const onpremCount = licenses.filter((l) => l.type === 'onprem').length;
  const totalUserCount = licenses.reduce((s, l) => s + l.currentUsers, 0);

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between">
        <div>
          <p className={clsx('text-sm', t.sub)}>{licenses.length} licenses issued · {activeLicenseCount} active</p>
        </div>
        <button onClick={() => setShowGenerate(!showGenerate)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white text-sm font-medium transition-all">
          <Plus className="w-4 h-4" /> Generate License
        </button>
      </div>

      {showGenerate && (
        <div className={clsx('border rounded-2xl p-5 animate-slide-up', t.card)}>
          <h3 className={clsx('text-sm font-semibold mb-4', t.heading)}>Generate New License</h3>

          {/* Tenant name */}
          <div className="mb-4">
            <label className={clsx('block text-xs mb-1.5', t.sub)}>Tenant Name</label>
            <input type="text" value={genTenantName} onChange={(e) => setGenTenantName(e.target.value)} placeholder="Acme Corp"
              className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.input)} />
          </div>

          {/* Key row */}
          <div className="flex items-center gap-3 mb-4">
            <code className={clsx('flex-1 font-mono text-sm px-4 py-3 rounded-xl', t.cardInner, t.heading)}>{newKey}</code>
            <button onClick={() => copyKey(newKey)} className={clsx('flex items-center gap-1.5 px-4 py-3 rounded-xl text-sm font-medium transition-colors', copied === newKey ? 'bg-accent-500/20 text-accent-400' : t.btnSecondary)}>
              {copied === newKey ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied === newKey ? 'Copied' : 'Copy'}
            </button>
            <button onClick={() => setNewKey(generateLicenseKey())} className={clsx('px-3 py-3 rounded-xl text-sm font-medium transition-colors', t.btnSecondary)} title="Regenerate key">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Config row */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className={clsx('block text-xs mb-1.5', t.sub)}>Max Users</label>
              <input type="number" min={1} value={genMaxUsers} onChange={(e) => setGenMaxUsers(+e.target.value)}
                className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.input)} />
            </div>
            <div>
              <label className={clsx('block text-xs mb-1.5', t.sub)}>Validity Period</label>
              <select value={genValidityMonths} onChange={(e) => setGenValidityMonths(+e.target.value)}
                className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.input)}>
                <option value={1}>1 month</option>
                <option value={3}>3 months</option>
                <option value={6}>6 months</option>
                <option value={12}>1 year</option>
                <option value={24}>2 years</option>
                <option value={36}>3 years</option>
              </select>
            </div>
            <div>
              <label className={clsx('block text-xs mb-1.5', t.sub)}>Deployment</label>
              <select value={genType} onChange={(e) => setGenType(e.target.value as 'cloud' | 'onprem')}
                className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.input)}>
                <option value="cloud">Cloud</option>
                <option value="onprem">On-Premises</option>
              </select>
            </div>
          </div>

          {/* Summary + Save */}
          <div className={clsx('rounded-xl px-4 py-3 text-xs flex items-center justify-between', t.cardInner)}>
            <div>
              <span className={t.muted}>Expires: </span>
              <span className={clsx('font-medium', t.heading)}>
                {(() => { const d = new Date(); d.setMonth(d.getMonth() + genValidityMonths); return d.toISOString().slice(0, 10); })()}
              </span>
              <span className={clsx('mx-2', t.faint)}>·</span>
              <span className={t.muted}>Users: </span>
              <span className={clsx('font-medium', t.heading)}>{genMaxUsers}</span>
              <span className={clsx('mx-2', t.faint)}>·</span>
              <span className={t.muted}>Type: </span>
              <span className={clsx('font-medium', t.heading)}>{genType === 'cloud' ? 'Cloud' : 'On-Prem'}</span>
            </div>
            <button
              onClick={handleSaveLicense}
              disabled={!genTenantName.trim() || saved}
              className={clsx('px-4 py-1.5 rounded-lg text-xs font-medium transition-colors',
                saved ? 'bg-accent-500/20 text-accent-400' : 'bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40'
              )}
            >
              {saved ? 'Saved!' : 'Save License'}
            </button>
          </div>

          <p className={clsx('text-xs mt-3', t.muted)}>Enter a tenant name and configure the license before saving. The license will appear in the table below.</p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <Key className="w-5 h-5 text-brand-400 mb-3" />
          <p className={clsx('text-2xl font-bold', t.heading)}>{activeLicenseCount}</p>
          <p className={clsx('text-xs', t.sub)}>Active Licenses</p>
        </div>
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <Building2 className="w-5 h-5 text-accent-400 mb-3" />
          <p className={clsx('text-2xl font-bold', t.heading)}>{onpremCount}</p>
          <p className={clsx('text-xs', t.sub)}>On-Prem Deployments</p>
        </div>
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <AlertTriangle className="w-5 h-5 text-yellow-400 mb-3" />
          <p className={clsx('text-2xl font-bold', t.heading)}>{licenses.filter((l) => l.status === 'trial').length}</p>
          <p className={clsx('text-xs', t.sub)}>Trial Licenses</p>
        </div>
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <RefreshCw className="w-5 h-5 text-brand-400 mb-3" />
          <p className={clsx('text-2xl font-bold', t.heading)}>{totalUserCount}</p>
          <p className={clsx('text-xs', t.sub)}>Total Licensed Users</p>
        </div>
      </div>

      {/* License table */}
      <div className={clsx('border rounded-2xl overflow-hidden', t.card)}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={clsx('border-b', t.border)}>
                {['Tenant', 'License Key', 'Type', 'Plan', 'Users', 'Status', 'Heartbeat', 'Reporting', 'Expires'].map((h) => (
                  <th key={h} className={clsx('text-left px-4 py-3 text-xs font-medium uppercase tracking-wider whitespace-nowrap', t.muted)}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className={clsx('divide-y', t.divider)}>
              {licenses.map((lic) => {
                const sc = statusConfig[lic.status] || statusConfig.active;
                const usagePercent = lic.maxUsers > 0 ? Math.round((lic.currentUsers / lic.maxUsers) * 100) : 0;
                const reportingEnabled = lic.reportingConfig?.usageMetrics ?? true;
                return (
                  <tr key={lic.licenseKey} className={clsx('transition-colors', t.hoverRow)}>
                    <td className="px-4 py-3">
                      <span className={clsx('font-medium', t.heading)}>{lic.tenantName}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <code className={clsx('text-xs font-mono', t.muted)}>{lic.licenseKey}</code>
                        <button onClick={() => copyKey(lic.licenseKey)} className={clsx('p-1 rounded transition-colors', copied === lic.licenseKey ? 'text-accent-400' : clsx(t.faint, t.hoverText))}>
                          {copied === lic.licenseKey ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
                        lic.type === 'cloud' ? 'bg-brand-500/10 text-brand-400 ring-brand-500/20' : 'bg-accent-500/10 text-accent-400 ring-accent-500/20'
                      )}>{lic.type === 'cloud' ? 'Cloud' : 'On-Prem'}</span>
                    </td>
                    <td className={clsx('px-4 py-3 text-xs font-medium capitalize', t.body)}>{lic.plan}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={clsx('text-xs', t.body)}>{lic.currentUsers}/{lic.maxUsers}</span>
                        <div className={clsx('w-16 h-1.5 rounded-full overflow-hidden', t.track)}>
                          <div className={clsx('h-full rounded-full', usagePercent > 90 ? 'bg-red-400' : usagePercent > 70 ? 'bg-yellow-400' : 'bg-accent-400')} style={{ width: `${usagePercent}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1', sc.color)}>{sc.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('text-xs', t.faint)}>—</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('text-xs', reportingEnabled ? 'text-accent-400' : t.faint)}>
                        {reportingEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className={clsx('px-4 py-3 text-xs whitespace-nowrap', t.body)}>{lic.expiresAt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
