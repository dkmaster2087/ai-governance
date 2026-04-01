import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, ShieldCheck, ShieldOff,
  ChevronDown, ChevronRight, BadgeCheck, ArrowRight, AlertTriangle, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { fetchPolicies, deletePolicy, updatePolicyEnabled } from '../lib/api';
import { mockPolicies } from '../lib/mock-data';
import { Badge } from '../components/ui/Badge';
import { PolicyModal } from '../components/policies/PolicyModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';

const RULE_TYPE_LABEL: Record<string, string> = {
  keyword_block:       'Keyword Block',
  pii_detection:       'PII Detection',
  model_restriction:   'Model Restriction',
  data_classification: 'Data Classification',
  rate_limit:          'Rate Limit',
  cost_limit:          'Cost Limit',
  region_restriction:  'Region Restriction',
  audit_logging:       'Audit Logging',
};

export function PoliciesPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ policyId: string; name: string; sourceFramework?: string } | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<{ policyId: string; name: string; sourceFramework: string; currentEnabled: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 6000); };

  const { data } = useQuery({
    queryKey: ['policies'],
    queryFn: fetchPolicies,
    placeholderData: mockPolicies,
  });

  const policies: typeof mockPolicies = Array.isArray(data) && data.length ? data : mockPolicies;

  const deleteMutation = useMutation({
    mutationFn: (policyId: string) => deletePolicy(policyId),
    onSuccess: (_data, _policyId) => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['compliance-status'] });
      if (confirmDelete?.sourceFramework) {
        showToast(`Policy deleted — ${confirmDelete.sourceFramework} compliance framework has been disabled.`);
      }
    },
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: ({ policyId, enabled }: { policyId: string; enabled: boolean }) =>
      updatePolicyEnabled(policyId, enabled),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['compliance-status'] });
      if (!vars.enabled && confirmToggle?.sourceFramework) {
        showToast(`Policy disabled — ${confirmToggle.sourceFramework} compliance framework has been disabled.`);
      }
    },
  });

  const handleDeleteClick = (policy: any) => {
    setConfirmDelete({
      policyId: policy.policyId,
      name: policy.name,
      sourceFramework: policy.sourceFramework,
    });
  };

  const handleToggleEnabled = (policy: any) => {
    if (policy.sourceFramework && policy.enabled) {
      // Disabling a framework-linked policy — show confirmation
      setConfirmToggle({
        policyId: policy.policyId,
        name: policy.name,
        sourceFramework: policy.sourceFramework,
        currentEnabled: policy.enabled,
      });
    } else {
      toggleEnabledMutation.mutate({ policyId: policy.policyId, enabled: !policy.enabled });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className={clsx('text-sm', t.sub)}>{policies.length} policies configured</p>
          <p className={clsx('text-xs mt-0.5', t.muted)}>
            Policies contain rules evaluated on every AI request.{' '}
            <Link to="/compliance" className="text-brand-400 hover:text-brand-300 inline-flex items-center gap-0.5">
              Enable compliance frameworks <ArrowRight className="w-3 h-3" />
            </Link>
            {' '}to auto-generate required rules.
          </p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setModalOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Policy
        </button>
      </div>

      {/* Policy list */}
      <div className="space-y-3">
        {policies.map((policy) => (
          <div key={policy.policyId} className={clsx('border rounded-xl overflow-hidden', t.card)}>
            {/* Policy header */}
            <div
              className={clsx('flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors', t.hoverRow)}
              onClick={() => setExpanded(expanded === policy.policyId ? null : policy.policyId)}
            >
              <button
                className="flex-shrink-0"
                onClick={(e) => { e.stopPropagation(); handleToggleEnabled(policy); }}
                title={policy.enabled ? 'Disable policy' : 'Enable policy'}
              >
                <div className={clsx(
                  'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                  policy.enabled ? 'bg-accent-500/20 hover:bg-accent-500/30' : (isDark ? 'bg-slate-700 hover:bg-slate-600' : 'bg-gray-200 hover:bg-gray-300')
                )}>
                  {policy.enabled
                    ? <ShieldCheck className="w-4 h-4 text-accent-400" />
                    : <ShieldOff className={clsx('w-4 h-4', t.muted)} />
                  }
                </div>
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className={clsx('font-medium', t.heading)}>{policy.name}</h3>
                  <Badge label={policy.enabled ? 'Active' : 'Disabled'} variant={policy.enabled ? 'allow' : 'neutral'} />
                  {(policy as any).sourceFramework && (
                    <Link
                      to="/compliance"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 bg-brand-600/10 px-2 py-0.5 rounded-full"
                    >
                      <BadgeCheck className="w-3 h-3" />
                      {(policy as any).sourceFramework}
                    </Link>
                  )}
                </div>
                <p className={clsx('text-sm truncate', t.muted)}>{policy.description}</p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={clsx('text-xs', t.muted)}>
                  {policy.rules.length} rule{policy.rules.length !== 1 ? 's' : ''}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); setEditTarget(policy); setModalOpen(true); }}
                  className={clsx('p-1.5 rounded-lg transition-colors', t.muted, t.hoverText, t.hoverRow)}
                  aria-label="Edit policy"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteClick(policy); }}
                  className={clsx('p-1.5 rounded-lg hover:text-red-400 hover:bg-red-500/10 transition-colors', t.muted)}
                  aria-label="Delete policy"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                {expanded === policy.policyId
                  ? <ChevronDown className={clsx('w-4 h-4', t.muted)} />
                  : <ChevronRight className={clsx('w-4 h-4', t.muted)} />
                }
              </div>
            </div>

            {/* Rules preview */}
            {expanded === policy.policyId && (
              <div className={clsx('border-t px-5 py-4 space-y-2', t.border)}>
                <div className="flex items-center justify-between mb-3">
                  <p className={clsx('text-xs font-medium uppercase tracking-wider', t.muted)}>Rules</p>
                  <button
                    onClick={() => { setEditTarget(policy); setModalOpen(true); }}
                    className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add / edit rules
                  </button>
                </div>

                {policy.rules.length === 0 ? (
                  <p className={clsx('text-sm py-2', t.faint)}>No rules — click "Add / edit rules" to add some.</p>
                ) : (
                  policy.rules.map((rule) => (
                    <div key={rule.ruleId} className={clsx('flex items-start gap-3 rounded-lg p-3', t.cardInnerHover)}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={clsx('text-sm font-medium', t.heading)}>
                            {RULE_TYPE_LABEL[rule.type] ?? rule.type}
                          </span>
                          <Badge
                            label={rule.action}
                            variant={rule.action as 'allow' | 'block' | 'mask' | 'warn'}
                          />
                          <span className={clsx('text-xs', t.faint)}>Priority {rule.priority}</span>
                        </div>
                        <p className={clsx('text-xs', t.muted)}>{rule.description}</p>
                        {(rule.config as any).keywords?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {((rule.config as any).keywords as string[]).map((kw: string) => (
                              <span key={kw} className={clsx('text-xs px-2 py-0.5 rounded-full font-mono', isDark ? 'bg-slate-700' : 'bg-gray-200', t.body)}>
                                {kw}
                              </span>
                            ))}
                          </div>
                        )}
                        {(rule.config as any).allowedModels?.length > 0 && (
                          <p className={clsx('text-xs mt-1', t.muted)}>
                            Allowed: {((rule.config as any).allowedModels as string[]).join(', ')}
                          </p>
                        )}
                      </div>
                      <div className={clsx(
                        'w-2 h-2 rounded-full mt-1.5 flex-shrink-0',
                        rule.enabled ? 'bg-accent-400' : (isDark ? 'bg-slate-600' : 'bg-gray-300')
                      )} />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {modalOpen && (
        <PolicyModal
          policy={editTarget}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ['policies'] });
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete?.sourceFramework ? 'Delete framework-linked policy?' : 'Delete policy?'}
        message={
          confirmDelete?.sourceFramework
            ? `'${confirmDelete.name}' is linked to the ${confirmDelete.sourceFramework} compliance framework. Deleting it will break the framework link. If you re-enable the framework later, a new policy will be created.`
            : `Are you sure you want to delete '${confirmDelete?.name ?? 'this policy'}'?`
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={() => { if (confirmDelete) { deleteMutation.mutate(confirmDelete.policyId); setConfirmDelete(null); } }}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={!!confirmToggle}
        title={`${confirmToggle?.currentEnabled ? 'Disable' : 'Enable'} framework-linked policy?`}
        message={`'${confirmToggle?.name ?? ''}' is linked to the ${confirmToggle?.sourceFramework ?? ''} compliance framework. ${confirmToggle?.currentEnabled ? 'Disabling' : 'Enabling'} it may affect compliance status.`}
        confirmLabel={confirmToggle?.currentEnabled ? 'Disable' : 'Enable'}
        confirmVariant={confirmToggle?.currentEnabled ? 'danger' : 'primary'}
        onConfirm={() => { if (confirmToggle) { toggleEnabledMutation.mutate({ policyId: confirmToggle.policyId, enabled: !confirmToggle.currentEnabled }); setConfirmToggle(null); } }}
        onCancel={() => setConfirmToggle(null)}
      />

      {toast && (
        <div className={clsx(
          'fixed bottom-6 right-6 z-50 flex items-center gap-3 border rounded-xl px-5 py-4 shadow-2xl max-w-md animate-[slideUp_0.3s_ease-out]',
          t.card
        )}>
          <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
          <p className={clsx('text-sm', t.heading)}>{toast}</p>
          <button onClick={() => setToast(null)} className={clsx('flex-shrink-0 ml-2', t.muted)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
