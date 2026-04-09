import { useState } from 'react';
import { Key, Plus, Copy, Check, Building2, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';

interface License {
  id: string;
  tenantName: string;
  tenantId: string;
  licenseKey: string;
  type: 'cloud' | 'onprem';
  plan: string;
  status: 'active' | 'expired' | 'revoked' | 'trial';
  issuedAt: string;
  expiresAt: string;
  maxUsers: number;
  currentUsers: number;
  lastHeartbeat?: string;
  reportingEnabled: boolean;
}

const mockLicenses: License[] = [
  { id: 'lic_1', tenantName: 'Demo Corp', tenantId: 'tenant_demo', licenseKey: 'AEGIS-DEMO-XXXX-XXXX', type: 'cloud', plan: 'professional', status: 'active', issuedAt: '2026-01-01', expiresAt: '2027-01-01', maxUsers: 50, currentUsers: 45, lastHeartbeat: '2026-04-01T20:00:00Z', reportingEnabled: true },
  { id: 'lic_2', tenantName: 'HealthCo Systems', tenantId: 'tenant_healthco', licenseKey: 'AEGIS-HC01-XXXX-XXXX', type: 'onprem', plan: 'enterprise', status: 'active', issuedAt: '2026-01-15', expiresAt: '2027-01-15', maxUsers: 200, currentUsers: 120, lastHeartbeat: '2026-04-01T19:55:00Z', reportingEnabled: true },
  { id: 'lic_3', tenantName: 'FinTech Inc', tenantId: 'tenant_fintech', licenseKey: 'AEGIS-FT01-XXXX-XXXX', type: 'cloud', plan: 'enterprise', status: 'active', issuedAt: '2026-02-01', expiresAt: '2027-02-01', maxUsers: 100, currentUsers: 38, reportingEnabled: true },
  { id: 'lic_4', tenantName: 'RetailMax', tenantId: 'tenant_retail', licenseKey: 'AEGIS-RM01-XXXX-XXXX', type: 'onprem', plan: 'professional', status: 'trial', issuedAt: '2026-03-20', expiresAt: '2026-04-20', maxUsers: 50, currentUsers: 32, lastHeartbeat: '2026-04-01T18:30:00Z', reportingEnabled: false },
  { id: 'lic_5', tenantName: 'LegalFirm LLP', tenantId: 'tenant_legal', licenseKey: 'AEGIS-LF01-XXXX-XXXX', type: 'cloud', plan: 'starter', status: 'active', issuedAt: '2026-03-01', expiresAt: '2027-03-01', maxUsers: 20, currentUsers: 12, reportingEnabled: true },
];

function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `AEGIS-${seg()}-${seg()}-${seg()}`;
}

export function LicensesPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const [licenses] = useState(mockLicenses);
  const [copied, setCopied] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [newKey] = useState(generateLicenseKey());

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

  const activeLicenses = licenses.filter((l) => l.status === 'active' || l.status === 'trial').length;
  const onpremCount = licenses.filter((l) => l.type === 'onprem').length;
  const totalUsers = licenses.reduce((s, l) => s + l.currentUsers, 0);

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between">
        <div>
          <p className={clsx('text-sm', t.sub)}>{licenses.length} licenses issued · {activeLicenses} active</p>
        </div>
        <button onClick={() => setShowGenerate(!showGenerate)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white text-sm font-medium transition-all">
          <Plus className="w-4 h-4" /> Generate License
        </button>
      </div>

      {showGenerate && (
        <div className={clsx('border rounded-2xl p-5 animate-slide-up', t.card)}>
          <h3 className={clsx('text-sm font-semibold mb-3', t.heading)}>New License Key</h3>
          <div className="flex items-center gap-3">
            <code className={clsx('flex-1 font-mono text-sm px-4 py-3 rounded-xl', t.cardInner, t.heading)}>{newKey}</code>
            <button onClick={() => copyKey(newKey)} className={clsx('flex items-center gap-1.5 px-4 py-3 rounded-xl text-sm font-medium transition-colors', copied === newKey ? 'bg-accent-500/20 text-accent-400' : t.btnSecondary)}>
              {copied === newKey ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied === newKey ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className={clsx('text-xs mt-3', t.muted)}>Share this key with the tenant to activate their on-prem installation. The key will be validated on first connection.</p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <Key className="w-5 h-5 text-brand-400 mb-3" />
          <p className={clsx('text-2xl font-bold', t.heading)}>{activeLicenses}</p>
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
          <p className={clsx('text-2xl font-bold', t.heading)}>{totalUsers}</p>
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
                const sc = statusConfig[lic.status];
                const usagePercent = Math.round((lic.currentUsers / lic.maxUsers) * 100);
                return (
                  <tr key={lic.id} className={clsx('transition-colors', t.hoverRow)}>
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
                      {lic.lastHeartbeat ? (
                        <span className={clsx('text-xs flex items-center gap-1', t.body)}>
                          <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse-soft" />
                          {new Date(lic.lastHeartbeat).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      ) : (
                        <span className={clsx('text-xs', t.faint)}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('text-xs', lic.reportingEnabled ? 'text-accent-400' : t.faint)}>
                        {lic.reportingEnabled ? 'Enabled' : 'Disabled'}
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
