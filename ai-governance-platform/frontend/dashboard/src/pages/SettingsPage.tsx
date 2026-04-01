import { useState } from 'react';
import { Save } from 'lucide-react';
import clsx from 'clsx';
import { Toggle } from '../components/ui/Toggle';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';

export function SettingsPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState({
    tenantName: 'Demo Corp',
    maxTokensPerRequest: 4096,
    maxRequestsPerMinute: 100,
    piiMaskingEnabled: true,
    allowExternalProviders: true,
    auditLogRetentionDays: 365,
    dataResidencyRegion: 'us-east-1',
  });

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className={clsx('flex items-center justify-between py-4 border-b last:border-0', t.border)}>
      <label className={clsx('text-sm font-medium', t.body)}>{label}</label>
      <div className="w-64">{children}</div>
    </div>
  );

  return (
    <div className="max-w-2xl space-y-6">
      {/* Tenant */}
      <div className={clsx('border rounded-xl p-6', t.card)}>
        <h2 className={clsx('text-sm font-semibold mb-1', t.heading)}>Tenant Settings</h2>
        <p className={clsx('text-xs mb-5', t.muted)}>Configuration for your organization</p>
        <Field label="Organization Name">
          <input
            type="text"
            value={settings.tenantName}
            onChange={(e) => setSettings((s) => ({ ...s, tenantName: e.target.value }))}
            className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.input)}
          />
        </Field>
        <Field label="Data Residency Region">
          <select
            value={settings.dataResidencyRegion}
            onChange={(e) => setSettings((s) => ({ ...s, dataResidencyRegion: e.target.value }))}
            className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.input)}
          >
            <option value="us-east-1">US East (N. Virginia)</option>
            <option value="us-west-2">US West (Oregon)</option>
            <option value="ca-central-1">Canada (Central)</option>
            <option value="eu-west-1">Europe (Ireland)</option>
          </select>
        </Field>
      </div>

      {/* Limits */}
      <div className={clsx('border rounded-xl p-6', t.card)}>
        <h2 className={clsx('text-sm font-semibold mb-1', t.heading)}>Rate & Token Limits</h2>
        <p className={clsx('text-xs mb-5', t.muted)}>Control usage across your organization</p>
        <Field label="Max Tokens per Request">
          <input
            type="number"
            value={settings.maxTokensPerRequest}
            onChange={(e) => setSettings((s) => ({ ...s, maxTokensPerRequest: +e.target.value }))}
            className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.input)}
          />
        </Field>
        <Field label="Max Requests per Minute">
          <input
            type="number"
            value={settings.maxRequestsPerMinute}
            onChange={(e) => setSettings((s) => ({ ...s, maxRequestsPerMinute: +e.target.value }))}
            className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.input)}
          />
        </Field>
        <Field label="Audit Log Retention (days)">
          <input
            type="number"
            value={settings.auditLogRetentionDays}
            onChange={(e) => setSettings((s) => ({ ...s, auditLogRetentionDays: +e.target.value }))}
            className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.input)}
          />
        </Field>
      </div>

      {/* Features */}
      <div className={clsx('border rounded-xl p-6', t.card)}>
        <h2 className={clsx('text-sm font-semibold mb-1', t.heading)}>Features</h2>
        <p className={clsx('text-xs mb-5', t.muted)}>Enable or disable platform capabilities</p>
        <Field label="PII Masking">
          <Toggle checked={settings.piiMaskingEnabled} onChange={(v) => setSettings((s) => ({ ...s, piiMaskingEnabled: v }))} />
        </Field>
        <Field label="Allow External AI Providers">
          <Toggle checked={settings.allowExternalProviders} onChange={(v) => setSettings((s) => ({ ...s, allowExternalProviders: v }))} />
        </Field>
      </div>

      <button
        onClick={handleSave}
        className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-all"
      >
        <Save className="w-4 h-4" />
        {saved ? 'Saved!' : 'Save Changes'}
      </button>
    </div>
  );
}
