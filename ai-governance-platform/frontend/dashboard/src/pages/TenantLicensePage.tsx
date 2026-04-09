import { useState } from 'react';
import { Key, Copy, Check, Users, Calendar, Shield, Activity } from 'lucide-react';
import clsx from 'clsx';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';
import { useAuth } from '../lib/auth';
import { getTenantLicense, updateTenantLicense, type TenantLicense } from '../lib/license';
import { Toggle } from '../components/ui/Toggle';

export function TenantLicensePage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const license = getTenantLicense(user?.tenantId ?? '');
  const [reporting, setReporting] = useState(license?.reportingConfig ?? {
    usageMetrics: true, costData: true, complianceStatus: true, auditLogs: false,
  });

  const copyKey = () => {
    if (!license) return;
    navigator.clipboard.writeText(license.licenseKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveReporting = () => {
    if (!user?.tenantId) return;
    updateTenantLicense(user.tenantId, { reportingConfig: reporting });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!license) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Key className={clsx('w-12 h-12 mb-4', t.faint)} />
        <p className={clsx('text-lg font-semibold', t.heading)}>No License Found</p>
        <p className={clsx('text-sm mt-1', t.muted)}>Contact your platform administrator to provision a license for this tenant.</p>
      </div>
    );
  }

  const usagePercent = license.maxUsers > 0 ? Math.round((license.currentUsers / license.maxUsers) * 100) : 0;
  const daysLeft = Math.max(0, Math.ceil((new Date(license.expiresAt).getTime() - Date.now()) / 86400000));

  return (
    <div className="max-w-3xl space-y-6">
      {/* License key card */}
      <div className={clsx('border rounded-2xl p-6', t.card)}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center">
            <Key className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h2 className={clsx('text-sm font-semibold', t.heading)}>License Key</h2>
            <p className={clsx('text-xs', t.muted)}>Your organization's Aegis AI license</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <code className={clsx('flex-1 font-mono text-sm px-4 py-3 rounded-xl', t.cardInner, t.heading)}>{license.licenseKey}</code>
          <button onClick={copyKey} className={clsx('flex items-center gap-1.5 px-4 py-3 rounded-xl text-sm font-medium transition-colors', copied ? 'bg-accent-500/20 text-accent-400' : t.btnSecondary)}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <Shield className="w-5 h-5 text-accent-400 mb-3" />
          <span className={clsx('text-xs px-2 py-0.5 rounded-lg font-medium ring-1',
            license.status === 'active' ? 'bg-accent-500/10 text-accent-400 ring-accent-500/20' :
            license.status === 'trial' ? 'bg-yellow-500/10 text-yellow-400 ring-yellow-500/20' :
            'bg-red-500/10 text-red-400 ring-red-500/20'
          )}>{license.status}</span>
          <p className={clsx('text-xs mt-2', t.sub)}>License Status</p>
        </div>
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <Users className="w-5 h-5 text-brand-400 mb-3" />
          <p className={clsx('text-2xl font-bold', t.heading)}>{license.currentUsers}<span className={clsx('text-sm font-normal', t.muted)}>/{license.maxUsers}</span></p>
          <p className={clsx('text-xs mt-1', t.sub)}>Licensed Users</p>
          <div className={clsx('h-1.5 rounded-full overflow-hidden mt-2', t.track)}>
            <div className={clsx('h-full rounded-full', usagePercent > 90 ? 'bg-red-400' : usagePercent > 70 ? 'bg-yellow-400' : 'bg-accent-400')} style={{ width: `${usagePercent}%` }} />
          </div>
        </div>
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <Calendar className="w-5 h-5 text-yellow-400 mb-3" />
          <p className={clsx('text-2xl font-bold', t.heading)}>{daysLeft}</p>
          <p className={clsx('text-xs mt-1', t.sub)}>Days Remaining</p>
        </div>
        <div className={clsx('border rounded-2xl p-5', t.card)}>
          <Activity className="w-5 h-5 text-brand-400 mb-3" />
          <p className={clsx('text-sm font-medium capitalize', t.heading)}>{license.plan}</p>
          <p className={clsx('text-xs mt-1', t.sub)}>Plan · {license.type === 'onprem' ? 'On-Prem' : 'Cloud'}</p>
        </div>
      </div>

      {/* License details */}
      <div className={clsx('border rounded-2xl p-6', t.card)}>
        <h3 className={clsx('text-sm font-semibold mb-4', t.heading)}>License Details</h3>
        <div className="grid grid-cols-2 gap-y-3 text-sm">
          {[
            ['Tenant', license.tenantName],
            ['Tenant ID', license.tenantId],
            ['Issued', license.issuedAt],
            ['Expires', license.expiresAt],
            ['Plan', license.plan],
            ['Deployment', license.type === 'onprem' ? 'On-Premises' : 'Cloud'],
          ].map(([label, value]) => (
            <div key={label}>
              <p className={clsx('text-xs', t.muted)}>{label}</p>
              <p className={clsx('font-medium', t.heading)}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Reporting config */}
      <div className={clsx('border rounded-2xl p-6', t.card)}>
        <h3 className={clsx('text-sm font-semibold mb-1', t.heading)}>Reporting Configuration</h3>
        <p className={clsx('text-xs mb-4', t.muted)}>Choose what data is reported to the Aegis AI platform</p>
        <div className="space-y-1">
          {([
            { key: 'usageMetrics' as const, label: 'Usage Metrics', hint: 'Request counts, model usage, user activity' },
            { key: 'costData' as const, label: 'Cost Data', hint: 'Token costs, billing breakdown' },
            { key: 'complianceStatus' as const, label: 'Compliance Status', hint: 'Framework status, control pass/fail' },
            { key: 'auditLogs' as const, label: 'Audit Logs', hint: 'Detailed request/response logs (may contain sensitive data)' },
          ]).map((item) => (
            <div key={item.key} className="flex items-center justify-between py-2.5">
              <div className="flex-1 min-w-0 mr-4">
                <p className={clsx('text-sm', t.body)}>{item.label}</p>
                <p className={clsx('text-xs mt-0.5', t.faint)}>{item.hint}</p>
              </div>
              <Toggle checked={reporting[item.key]} onChange={(v) => setReporting((r) => ({ ...r, [item.key]: v }))} />
            </div>
          ))}
        </div>
        <button onClick={handleSaveReporting} className="mt-4 px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors">
          {saved ? 'Saved!' : 'Save Reporting Config'}
        </button>
      </div>
    </div>
  );
}
