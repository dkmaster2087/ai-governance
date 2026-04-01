import { useState } from 'react';
import { Save, Copy, Check, Shield, Chrome } from 'lucide-react';
import clsx from 'clsx';
import { Toggle } from '../components/ui/Toggle';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';
import { useAuth } from '../lib/auth';

export function SettingsPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const CopyButton = ({ value, label }: { value: string; label: string }) => (
    <button
      onClick={() => copyToClipboard(value, label)}
      className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', copied === label ? 'bg-accent-500/20 text-accent-400' : t.btnSecondary)}
    >
      {copied === label ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied === label ? 'Copied' : 'Copy'}
    </button>
  );

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

      {/* Browser Extension */}
      <div className={clsx('border rounded-xl p-6', t.card)}>
        <div className="flex items-center gap-2 mb-1">
          <Chrome className="w-4 h-4 text-brand-400" />
          <h2 className={clsx('text-sm font-semibold', t.heading)}>Shadow AI Guard — Browser Extension</h2>
        </div>
        <p className={clsx('text-xs mb-5', t.muted)}>Detect and block unauthorized AI tool usage across your organization</p>

        <div className={clsx('flex items-center justify-between py-3 border-b', t.border)}>
          <div>
            <p className={clsx('text-sm font-medium', t.body)}>Tenant ID</p>
            <p className={clsx('text-xs mt-0.5', t.muted)}>Use this when configuring the browser extension</p>
          </div>
          <div className="flex items-center gap-2">
            <code className={clsx('text-sm font-mono px-3 py-1.5 rounded-lg', t.cardInner)}>{user?.tenantId ?? '—'}</code>
            {user?.tenantId && <CopyButton value={user.tenantId} label="tenantId" />}
          </div>
        </div>

        <div className={clsx('flex items-center justify-between py-3 border-b', t.border)}>
          <div>
            <p className={clsx('text-sm font-medium', t.body)}>Gateway URL</p>
            <p className={clsx('text-xs mt-0.5', t.muted)}>The extension reports events to this endpoint</p>
          </div>
          <div className="flex items-center gap-2">
            <code className={clsx('text-sm font-mono px-3 py-1.5 rounded-lg', t.cardInner)}>{window.location.origin.replace('5174', '3000')}</code>
            <CopyButton value={window.location.origin.replace('5174', '3000')} label="gatewayUrl" />
          </div>
        </div>

        <div className={clsx('flex items-center justify-between py-3', t.border)}>
          <div>
            <p className={clsx('text-sm font-medium', t.body)}>Dashboard URL</p>
            <p className={clsx('text-xs mt-0.5', t.muted)}>Blocked requests redirect here</p>
          </div>
          <div className="flex items-center gap-2">
            <code className={clsx('text-sm font-mono px-3 py-1.5 rounded-lg', t.cardInner)}>{window.location.origin}</code>
            <CopyButton value={window.location.origin} label="platformUrl" />
          </div>
        </div>

        <div className={clsx('mt-4 rounded-lg px-4 py-3 text-xs leading-relaxed', t.cardInner)}>
          <p className={clsx('font-medium mb-2', t.heading)}>Setup Instructions</p>
          <ol className={clsx('list-decimal list-inside space-y-1', t.sub)}>
            <li>Open Chrome → <code className="font-mono">chrome://extensions</code></li>
            <li>Enable "Developer mode" (top right)</li>
            <li>Click "Load unpacked" → select the <code className="font-mono">extensions/shadow-ai-guard</code> folder</li>
            <li>Click the extension icon → paste the Tenant ID above</li>
            <li>Set mode to Monitor or Block → Save & Apply</li>
          </ol>
        </div>
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
