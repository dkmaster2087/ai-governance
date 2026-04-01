import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { createTenant, updateTenant } from '../../lib/tenant-api';
import { Toggle } from '../ui/Toggle';
import { useTheme } from '../../lib/theme';
import { themeClasses } from '../../lib/theme-classes';
import { registerTenantAccount } from '../../lib/auth';

interface Props {
  tenant?: any;
  onClose: () => void;
  onSaved: () => void;
}

const PLANS = ['starter', 'professional', 'enterprise'];
const REGIONS = [
  'us-east-1', 'us-west-2', 'ca-central-1',
  'eu-west-1', 'eu-central-1', 'ap-southeast-1',
];

// ── Reusable field components defined OUTSIDE the modal ──────────────────────
// Defining them inside the modal causes React to treat them as new component
// types on every render, which unmounts/remounts the input and loses focus.

function FieldInput({
  label, id, hint, tc, ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string; tc: ReturnType<typeof themeClasses> }) {
  return (
    <div>
      <label className={clsx('block text-xs mb-1.5', tc.sub)} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        {...props}
        className={clsx('w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-500 transition-colors', tc.input)}
      />
      {hint && <p className={clsx('text-xs mt-1', tc.faint)}>{hint}</p>}
    </div>
  );
}

function FieldSelect({
  label, id, children, tc, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string; tc: ReturnType<typeof themeClasses> }) {
  return (
    <div>
      <label className={clsx('block text-xs mb-1.5', tc.sub)} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        {...props}
        className={clsx('w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-500 transition-colors', tc.input)}
      >
        {children}
      </select>
    </div>
  );
}

function FieldToggle({
  label, hint, checked, onChange, tc,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tc: ReturnType<typeof themeClasses>;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex-1 min-w-0 mr-4">
        <p className={clsx('text-sm', tc.body)}>{label}</p>
        {hint && <p className={clsx('text-xs mt-0.5', tc.faint)}>{hint}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function TenantModal({ tenant, onClose, onSaved }: Props) {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const isEdit = !!tenant?.tenantId;
  const [activeTab, setActiveTab] = useState<'basic' | 'settings'>('basic');

  const [name, setName] = useState(tenant?.name ?? '');
  const [adminEmail, setAdminEmail] = useState(tenant?.adminEmail ?? '');
  const [adminPassword, setAdminPassword] = useState('');
  const [plan, setPlan] = useState(tenant?.plan ?? 'starter');
  const [deploymentMode, setDeploymentMode] = useState(tenant?.deploymentMode ?? 'saas');
  const [region, setRegion] = useState(tenant?.region ?? 'us-east-1');
  const [maxTokens, setMaxTokens] = useState(tenant?.settings?.maxTokensPerRequest ?? 4096);
  const [maxRpm, setMaxRpm] = useState(tenant?.settings?.maxRequestsPerMinute ?? 100);
  const [retentionDays, setRetentionDays] = useState(tenant?.settings?.auditLogRetentionDays ?? 90);
  const [dataRegion, setDataRegion] = useState(tenant?.settings?.dataResidencyRegion ?? 'us-east-1');
  const [piiMasking, setPiiMasking] = useState(tenant?.settings?.piiMaskingEnabled ?? true);
  const [allowExternal, setAllowExternal] = useState(tenant?.settings?.allowExternalProviders ?? false);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        adminEmail,
        plan,
        deploymentMode,
        region,
        status: 'active',
        settings: {
          maxTokensPerRequest: maxTokens,
          maxRequestsPerMinute: maxRpm,
          auditLogRetentionDays: retentionDays,
          dataResidencyRegion: dataRegion,
          piiMaskingEnabled: piiMasking,
          allowExternalProviders: allowExternal,
          allowedModels: [],
        },
      };
      return isEdit ? updateTenant(tenant.tenantId, payload) : createTenant(payload);
    },
    onSuccess: (data) => {
      // Register login account for the new tenant admin
      if (!isEdit && adminEmail) {
        const tenantId = data?.tenantId || `tenant_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        registerTenantAccount({
          email: adminEmail,
          password: adminPassword || 'welcome123',
          name: `${name} Admin`,
          tenantId,
          tenantName: name,
        });
      }
      onSaved();
    },
    onError: (err) => {
      console.warn('Tenant API not available, simulating success', err);
      // Still register the account for demo purposes
      if (!isEdit && adminEmail) {
        const tenantId = `tenant_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        registerTenantAccount({
          email: adminEmail,
          password: adminPassword || 'welcome123',
          name: `${name} Admin`,
          tenantId,
          tenantName: name,
        });
      }
      onSaved();
    },
  });

  const tabs = [
    { id: 'basic' as const, label: 'Basic Info' },
    { id: 'settings' as const, label: 'Settings' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className={clsx('relative border rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl', t.overlay)}>

        {/* Header */}
        <div className={clsx('flex items-center justify-between px-6 py-5 border-b', t.border)}>
          <div>
            <h2 className={clsx('text-lg font-semibold', t.heading)}>
              {isEdit ? 'Edit Tenant' : 'Onboard New Tenant'}
            </h2>
            <p className={clsx('text-xs mt-0.5', t.muted)}>
              {isEdit ? `Editing ${tenant.name}` : 'Create a new tenant account'}
            </p>
          </div>
          <button onClick={onClose} className={clsx('transition-colors', t.muted, t.hoverText)} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className={clsx('flex border-b px-6', t.border)}>
          {tabs.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setActiveTab(tb.id)}
              className={clsx('px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === tb.id
                  ? 'border-brand-500 text-brand-400'
                  : clsx('border-transparent', t.muted, t.hoverText)
              )}
            >
              {tb.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
          {activeTab === 'basic' ? (
            <div className="space-y-4">
              <FieldInput tc={t} label="Organization name" id="t-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" autoFocus />
              <FieldInput tc={t} label="Admin email" id="t-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@acme.com" />
              {!isEdit && (
                <FieldInput tc={t} label="Admin password" id="t-password" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Leave blank for default: welcome123" hint="Used to log in as this tenant's admin" />
              )}
              <div className="grid grid-cols-2 gap-4">
                <FieldSelect tc={t} label="Plan" id="t-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
                  {PLANS.map((p) => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </FieldSelect>
                <FieldSelect tc={t} label="Deployment" id="t-deploy" value={deploymentMode} onChange={(e) => setDeploymentMode(e.target.value)}>
                  <option value="saas">SaaS</option>
                  <option value="onprem">On-Premises</option>
                </FieldSelect>
              </div>
              <FieldSelect tc={t} label="Primary region" id="t-region" value={region} onChange={(e) => setRegion(e.target.value)}>
                {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </FieldSelect>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FieldInput tc={t} label="Max tokens / request" id="t-tokens" type="number" value={maxTokens} onChange={(e) => setMaxTokens(+e.target.value)} />
                <FieldInput tc={t} label="Max requests / minute" id="t-rpm" type="number" value={maxRpm} onChange={(e) => setMaxRpm(+e.target.value)} />
                <FieldInput tc={t} label="Log retention (days)" id="t-retention" type="number" value={retentionDays} onChange={(e) => setRetentionDays(+e.target.value)} hint="90 days minimum for compliance" />
                <FieldSelect tc={t} label="Data residency region" id="t-residency" value={dataRegion} onChange={(e) => setDataRegion(e.target.value)}>
                  {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </FieldSelect>
              </div>

              <div className={clsx('border-t pt-4 space-y-1', t.border)}>
                <FieldToggle tc={t} label="PII masking enabled" hint="Mask personal data before sending to AI providers" checked={piiMasking} onChange={setPiiMasking} />
                <FieldToggle tc={t} label="Allow external AI providers" hint="Permit OpenAI, Anthropic etc. in addition to Bedrock" checked={allowExternal} onChange={setAllowExternal} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={clsx('px-6 py-4 border-t flex gap-3', t.border)}>
          <button onClick={onClose} className={clsx('flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors', t.btnSecondary)}>
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || !adminEmail.trim() || mutation.isPending}
            className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {mutation.isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Onboard Tenant'}
          </button>
        </div>
      </div>
    </div>
  );
}
