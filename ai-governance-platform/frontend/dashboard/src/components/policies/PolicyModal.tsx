import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, BadgeCheck, ArrowRight, AlertTriangle, CheckCircle } from 'lucide-react';
import clsx from 'clsx';
import { createPolicy, updatePolicy } from '../../lib/api';
import { PolicyRuleEditor, PolicyRule } from './PolicyRuleEditor';
import { Toggle } from '../ui/Toggle';
import { useTheme } from '../../lib/theme';
import { themeClasses } from '../../lib/theme-classes';

interface Props {
  policy: {
    policyId: string;
    name: string;
    description: string;
    enabled: boolean;
    rules: PolicyRule[];
    sourceFramework?: string;
  } | null;
  onClose: () => void;
  onSaved: () => void;
}

export function PolicyModal({ policy, onClose, onSaved }: Props) {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const queryClient = useQueryClient();
  const isEdit = !!policy;
  const isFrameworkLinked = !!policy?.sourceFramework;
  const [name, setName] = useState(policy?.name ?? '');
  const [description, setDescription] = useState(policy?.description ?? '');
  const [enabled, setEnabled] = useState(policy?.enabled ?? true);
  const [rules, setRules] = useState<PolicyRule[]>(
    (policy?.rules ?? []) as PolicyRule[]
  );
  const [toast, setToast] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const tenantId = (() => { try { return JSON.parse(localStorage.getItem('aegis_auth_user') || '{}').tenantId || 'tenant_demo'; } catch { return 'tenant_demo'; } })();
      const payload = {
        tenantId,
        name,
        description,
        enabled,
        rules,
        createdBy: 'admin',
      };
      return isEdit ? updatePolicy(policy!.policyId, payload) : createPolicy(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-status'] });
      if (isFrameworkLinked) {
        const fw = policy!.sourceFramework!;
        if (enabled !== policy!.enabled) {
          const msg = enabled
            ? `Policy enabled — ${fw} compliance framework has been re-enabled.`
            : `Policy disabled — ${fw} compliance framework has been disabled.`;
          setToast(msg);
          setTimeout(() => { setToast(null); onSaved(); }, 2500);
          return;
        }
      }
      onSaved();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className={clsx('relative border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl', t.overlay)}>

        {/* Header */}
        <div className={clsx('flex items-center justify-between px-6 py-5 border-b', t.border)}>
          <div>
            <h2 className={clsx('text-lg font-semibold', t.heading)}>
              {isEdit ? 'Edit Policy' : 'New Policy'}
            </h2>
            {policy?.sourceFramework && (
              <div className="flex items-center gap-1.5 mt-1 text-xs text-brand-400">
                <BadgeCheck className="w-3.5 h-3.5" />
                Generated from {policy.sourceFramework}
              </div>
            )}
          </div>
          <button onClick={onClose} className={clsx('transition-colors', t.muted, t.hoverText)} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-5">
          {/* Framework-linked warning banner */}
          {policy?.sourceFramework && (
            <div className={clsx(
              'flex items-start gap-2.5 text-sm rounded-lg px-4 py-3 border',
              isDark
                ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300'
                : 'bg-yellow-50 border-yellow-200 text-yellow-800'
            )}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                This policy is linked to the {policy.sourceFramework} compliance framework. Changes may affect compliance status.
              </span>
            </div>
          )}
          {/* Name & description */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={clsx('block text-xs mb-1.5', t.sub)} htmlFor="p-name">Policy name</label>
              <input
                id="p-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. PII Protection Policy"
                className={clsx('w-full border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-brand-500 transition-colors', t.input)}
              />
            </div>
            <div className="col-span-2">
              <label className={clsx('block text-xs mb-1.5', t.sub)} htmlFor="p-desc">Description</label>
              <textarea
                id="p-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this policy enforce?"
                className={clsx('w-full border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-brand-500 transition-colors resize-none', t.input)}
              />
            </div>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center gap-3">
            <Toggle checked={enabled} onChange={setEnabled} />
            <span className={clsx('text-sm', t.sub)}>Policy {enabled ? 'enabled' : 'disabled'}</span>
          </div>

          {/* Rules */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className={clsx('text-sm font-semibold', t.heading)}>
                Rules
                <span className={clsx('ml-2 text-xs font-normal', t.muted)}>
                  {rules.length} rule{rules.length !== 1 ? 's' : ''} · evaluated in priority order
                </span>
              </h3>
            </div>
            <PolicyRuleEditor rules={rules} onChange={setRules} />
          </div>

          {/* Compliance link hint */}
          <div className={clsx('flex items-center gap-2 text-xs rounded-lg px-3 py-2.5', t.faint, t.cardInner)}>
            <BadgeCheck className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" />
            <span>
              Need compliance-specific rules?{' '}
              <button onClick={onClose} className="text-brand-400 hover:text-brand-300 inline-flex items-center gap-0.5">
                Go to Compliance <ArrowRight className="w-3 h-3" />
              </button>
              {' '}to enable a framework and auto-generate required rules.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className={clsx('px-6 py-4 border-t flex flex-col gap-3', t.border)}>
          {toast && (
            <div className={clsx('flex items-center gap-2 text-sm rounded-lg px-4 py-3', enabled ? 'bg-accent-500/10 text-accent-400' : 'bg-yellow-500/10 text-yellow-400')}>
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              {toast}
            </div>
          )}
          <div className="flex gap-3">
          <button onClick={onClose} className={clsx('flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors', t.btnSecondary)}>
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || mutation.isPending}
            className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {mutation.isPending ? 'Saving...' : `${isEdit ? 'Save' : 'Create'} Policy (${rules.length} rule${rules.length !== 1 ? 's' : ''})`}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
