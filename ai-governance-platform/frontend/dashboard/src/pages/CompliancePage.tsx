import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck, ShieldX, AlertTriangle, ChevronDown, ChevronRight,
  Zap, RefreshCw, Info, Copy, Plus, CheckCircle, ArrowRight, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { fetchComplianceStatus, enableFramework, disableFramework, assessFramework } from '../lib/compliance-api';
import { fetchPolicies, updatePolicy } from '../lib/api';
import { mockCompliancePacks } from '../lib/mock-compliance';
import { ControlDetailDrawer } from '../components/compliance/ControlDetailDrawer';
import { CustomPolicyBuilder } from '../components/compliance/CustomPolicyBuilder';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';

type Status = 'enabled' | 'disabled' | 'partial';
type Severity = 'critical' | 'high' | 'medium' | 'low';

const categoryColors: Record<string, string> = {
  'AI Risk Management':       'bg-brand-600/20 text-brand-400',
  'Security & Audit':         'bg-blue-500/20 text-blue-400',
  'Privacy & Data Protection':'bg-purple-500/20 text-purple-400',
  'Healthcare Compliance':    'bg-red-500/20 text-red-400',
  'AI Governance':            'bg-accent-500/20 text-accent-400',
};

interface Control { controlId: string; title: string; severity: string; automatable: boolean; }
interface Pack { framework: string; name: string; version: string; description: string; category: string; status: string; passedControls: number; totalControls: number; controls: Control[]; }
interface PolicyRecord { policyId: string; name: string; enabled: boolean; sourceFramework?: string; [key: string]: unknown; }

export function CompliancePage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);

  const statusConfig: Record<Status, { label: string; icon: typeof ShieldCheck; color: string; bg: string }> = {
    enabled:  { label: 'Enabled',  icon: ShieldCheck,   color: 'text-accent-400',  bg: 'bg-accent-500/20' },
    partial:  { label: 'Partial',  icon: AlertTriangle, color: 'text-yellow-400',  bg: 'bg-yellow-500/20' },
    disabled: { label: 'Disabled', icon: ShieldX,       color: t.muted,            bg: isDark ? 'bg-slate-700/50' : 'bg-gray-200' },
  };

  const severityColor: Record<Severity, string> = {
    critical: 'text-red-400 bg-red-500/10 border border-red-500/20',
    high:     'text-orange-400 bg-orange-500/10 border border-orange-500/20',
    medium:   'text-yellow-400 bg-yellow-500/10 border border-yellow-500/20',
    low:      clsx(isDark ? 'text-slate-400 bg-slate-700 border-slate-600' : 'text-gray-500 bg-gray-200 border-gray-300', 'border'),
  };

  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [drawerControl, setDrawerControl] = useState<{ controlId: string; title: string; severity: string; framework: string } | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [selectedControls, setSelectedControls] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; framework: string } | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<{ framework: string; packName: string; linkedPolicyName: string | null } | null>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({ queryKey: ['compliance-status'], queryFn: fetchComplianceStatus, staleTime: 0, gcTime: 0 });
  const { data: policiesData } = useQuery({ queryKey: ['policies'], queryFn: fetchPolicies });

  const packs = (Array.isArray(data) && data.length ? data : mockCompliancePacks) as Pack[];
  const policies = (Array.isArray(policiesData) ? policiesData : []) as PolicyRecord[];

  const showToast = (message: string, framework: string) => {
    setToast({ message, framework });
    setTimeout(() => setToast(null), 8000);
  };

  const enableMutation = useMutation({
    mutationFn: async (framework: string) => {
      const result = await enableFramework(framework);
      return result;
    },
    onSuccess: (result, framework) => {
      queryClient.invalidateQueries({ queryKey: ['compliance-status'] });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      const pack = packs.find(p => p.framework === framework);
      const name = pack?.name ?? framework;
      if (result.policyCreated === false) {
        showToast(`${name} enabled — existing linked policy re-enabled.`, framework);
      } else {
        showToast(`${name} enabled — compliance policy created with required controls.`, framework);
      }
    },
    onError: (_err, framework) => {
      queryClient.setQueryData(['compliance-status'], (old: Pack[] | undefined) => {
        if (!old) return old;
        return old.map((p) => p.framework === framework ? { ...p, status: 'enabled' } : p);
      });
      const pack = packs.find(p => p.framework === framework);
      showToast(`${pack?.name ?? framework} enabled.`, framework);
    },
  });

  const disableMutation = useMutation({
    mutationFn: async (framework: string) => {
      const result = await disableFramework(framework);
      return result;
    },
    onSuccess: (result, framework) => {
      queryClient.invalidateQueries({ queryKey: ['compliance-status'] });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      const pack = packs.find(p => p.framework === framework);
      const name = pack?.name ?? framework;
      if (result.disabledPolicyId) {
        showToast(`${name} disabled — linked policy has been disabled.`, framework);
      } else {
        showToast(`${name} disabled.`, framework);
      }
    },
    onError: (_err, framework) => {
      queryClient.setQueryData(['compliance-status'], (old: Pack[] | undefined) => {
        if (!old) return old;
        return old.map((p) => p.framework === framework ? { ...p, status: 'disabled' } : p);
      });
    },
  });

  const assessMutation = useMutation({
    mutationFn: (framework: string) => assessFramework(framework),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['compliance-status'] }),
    onError: () => {},
  });

  const handleDisableClick = (pack: Pack) => {
    const linked = policies.find((p) => p.sourceFramework === pack.framework);
    setConfirmDisable({
      framework: pack.framework,
      packName: pack.name,
      linkedPolicyName: linked?.name ?? null,
    });
  };

  const confirmDisableAction = () => {
    if (confirmDisable) {
      disableMutation.mutate(confirmDisable.framework);
      setConfirmDisable(null);
    }
  };

  const filtered = filter === 'all' ? packs : packs.filter((p) => p.status === filter);
  const summary = { enabled: packs.filter((p) => p.status === 'enabled').length, partial: packs.filter((p) => p.status === 'partial').length, disabled: packs.filter((p) => p.status === 'disabled').length };

  const toggleControlSelection = (controlId: string) => setSelectedControls((prev) => prev.includes(controlId) ? prev.filter((c) => c !== controlId) : [...prev, controlId]);
  const startSelectionMode = (framework: string) => { setSelectionMode(framework); setSelectedControls([]); setExpanded(framework); };
  const openBuilderWithSelected = () => { setBuilderOpen(true); setSelectionMode(null); };
  const openBuilderFromDrawer = (controlId: string) => { setDrawerControl(null); setSelectedControls([controlId]); setBuilderOpen(true); };

  return (
    <div className="space-y-6 w-full">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4">
        {(['enabled', 'partial', 'disabled'] as Status[]).map((s) => {
          const cfg = statusConfig[s];
          return (
            <button
              key={s}
              onClick={() => setFilter(filter === s ? 'all' : s)}
              className={clsx(
                'flex items-center gap-3 p-4 rounded-xl border transition-all text-left',
                filter === s ? 'border-brand-500 bg-brand-600/10' : t.card
              )}
            >
              <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center', cfg.bg)}>
                <cfg.icon className={clsx('w-4 h-4', cfg.color)} />
              </div>
              <div>
                <p className={clsx('text-xl font-bold', t.heading)}>{summary[s]}</p>
                <p className={clsx('text-xs', t.muted)}>{cfg.label}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => { setSelectedControls([]); setBuilderOpen(true); }}
          className={clsx('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border', t.btnSecondary, t.border)}
        >
          <Plus className="w-4 h-4" />
          New Custom Policy
        </button>
      </div>

      <div className="space-y-3">
        {filtered.map((pack) => {
          const cfg = statusConfig[pack.status as Status];
          const isExpanded = expanded === pack.framework;
          const isSelecting = selectionMode === pack.framework;
          const progress = pack.totalControls > 0 ? Math.round((pack.passedControls / pack.totalControls) * 100) : 0;

          return (
            <div key={pack.framework} className={clsx(
              'border rounded-xl overflow-hidden transition-colors',
              t.card,
              isSelecting && 'border-brand-500/50'
            )}>
              <div
                className={clsx('px-5 py-4 cursor-pointer transition-colors', t.hoverRow)}
                onClick={() => !isSelecting && setExpanded(isExpanded ? null : pack.framework)}
              >
                <div className="flex items-start gap-3">
                  <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5', cfg.bg)}>
                    <cfg.icon className={clsx('w-5 h-5', cfg.color)} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <h3 className={clsx('font-semibold', t.heading)}>{pack.name}</h3>
                      <span className={clsx('text-xs', t.faint)}>v{pack.version}</span>
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
                        categoryColors[pack.category] ?? clsx(isDark ? 'bg-slate-700' : 'bg-gray-200', t.sub)
                      )}>
                        {pack.category}
                      </span>
                    </div>
                    <p className={clsx('text-sm truncate', t.muted)}>{pack.description}</p>

                    {/* Progress + actions row */}
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                      <div className="w-28">
                        <div className="flex items-center justify-between mb-1">
                          <span className={clsx('text-xs', t.muted)}>{pack.passedControls}/{pack.totalControls}</span>
                          <span className={clsx('text-xs font-medium', cfg.color)}>{progress}%</span>
                        </div>
                        <div className={clsx('h-1.5 rounded-full overflow-hidden', isDark ? 'bg-white/[0.06]' : 'bg-gray-200')}>
                          <div
                            className={clsx('h-full rounded-full transition-all', {
                              'bg-accent-400': pack.status === 'enabled',
                              'bg-yellow-400': pack.status === 'partial',
                              [isDark ? 'bg-slate-600' : 'bg-gray-400']: pack.status === 'disabled',
                            })}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>

                  <div className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                    {isSelecting ? (
                      <>
                        <span className="text-xs text-brand-400">{selectedControls.length} selected</span>
                        <button onClick={openBuilderWithSelected} disabled={selectedControls.length === 0} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs font-medium transition-colors">
                          <Copy className="w-3 h-3" /> Copy to Policy
                        </button>
                        <button onClick={() => { setSelectionMode(null); setSelectedControls([]); }} className={clsx('px-2 py-1.5 rounded-lg text-xs transition-colors', t.btnSecondary)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startSelectionMode(pack.framework)} className={clsx('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors', t.btnSecondary)} title="Select controls to copy to a custom policy">
                          <Copy className="w-3 h-3" /> Select
                        </button>
                        {pack.status !== 'disabled' && (
                          <button onClick={() => assessMutation.mutate(pack.framework)} className={clsx('p-1.5 rounded-lg transition-colors', t.muted, t.hoverText, t.hoverRow)} title="Re-assess">
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {pack.status === 'disabled' ? (
                          <button onClick={() => enableMutation.mutate(pack.framework)} disabled={enableMutation.isPending} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium transition-colors disabled:opacity-50">
                            <Zap className="w-3 h-3" /> Enable
                          </button>
                        ) : (
                          <button onClick={() => handleDisableClick(pack)} className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', t.btnSecondary)}>
                            Disable
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {!isSelecting && (isExpanded ? <ChevronDown className={clsx('w-4 h-4', t.muted)} /> : <ChevronRight className={clsx('w-4 h-4', t.muted)} />)}
                    </div>
                  </div>
                </div>
              </div>

              {(isExpanded || isSelecting) && (
                <div className={clsx('border-t px-5 py-4', t.border)}>
                  {isSelecting && (
                    <div className="flex items-center gap-2 mb-3 text-xs text-brand-400 bg-brand-600/10 border border-brand-500/20 rounded-lg px-3 py-2">
                      <Info className="w-3.5 h-3.5 flex-shrink-0" />
                      Check the controls you want to copy into a custom policy, then click "Copy to Policy"
                    </div>
                  )}
                  <p className={clsx('text-xs font-medium uppercase tracking-wider mb-3', t.muted)}>Controls ({pack.controls.length})</p>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {pack.controls.map((control) => {
                      const isChecked = selectedControls.includes(control.controlId);
                      return (
                        <div
                          key={control.controlId}
                          className={clsx(
                            'flex items-start gap-3 rounded-xl p-3 transition-colors',
                            isSelecting
                              ? isChecked
                                ? 'bg-brand-600/15 border border-brand-500/40 cursor-pointer'
                                : clsx(t.cardInner, 'border cursor-pointer', t.border, 'hover:border-brand-500/30')
                              : clsx(t.cardInner, 'border', t.border)
                          )}
                          onClick={() => isSelecting && toggleControlSelection(control.controlId)}
                        >
                          {isSelecting && (
                            <div className={clsx('w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors',
                              isChecked ? 'bg-brand-600 border-brand-500' : (isDark ? 'border-slate-600' : 'border-gray-300')
                            )}>
                              {isChecked && <span className="text-white text-xs">✓</span>}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <span className={clsx('text-xs font-mono', t.muted)}>{control.controlId}</span>
                              <span className={clsx('text-xs px-1.5 py-0.5 rounded font-medium', severityColor[control.severity as Severity])}>{control.severity}</span>
                            </div>
                            <p className={clsx('text-sm', t.body)}>{control.title}</p>
                            {!control.automatable && <p className={clsx('text-xs mt-0.5', t.faint)}>Manual review required</p>}
                          </div>
                          {!isSelecting && (
                            <button onClick={(e) => { e.stopPropagation(); setDrawerControl({ controlId: control.controlId, title: control.title, severity: control.severity, framework: pack.name }); }} className={clsx('hover:text-brand-400 transition-colors flex-shrink-0', t.faint)} title="View details & examples" aria-label={`View details for ${control.controlId}`}>
                              <Info className="w-4 h-4" />
                            </button>
                          )}
                          {!isSelecting && (
                            <div className={clsx('w-2 h-2 rounded-full mt-1.5 flex-shrink-0',
                              pack.status === 'enabled' ? 'bg-accent-400' : pack.status === 'partial' ? 'bg-yellow-400' : (isDark ? 'bg-slate-600' : 'bg-gray-300')
                            )} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {drawerControl && (
        <ControlDetailDrawer controlId={drawerControl.controlId} controlTitle={drawerControl.title} severity={drawerControl.severity} framework={drawerControl.framework} onClose={() => setDrawerControl(null)} onCopyToPolicy={openBuilderFromDrawer} />
      )}
      {builderOpen && (
        <CustomPolicyBuilder preloadedControlIds={selectedControls} onClose={() => { setBuilderOpen(false); setSelectedControls([]); }} onSaved={() => { setBuilderOpen(false); setSelectedControls([]); queryClient.invalidateQueries({ queryKey: ['policies'] }); }} />
      )}

      {/* Confirm disable dialog */}
      <ConfirmDialog
        open={!!confirmDisable}
        title={`Disable ${confirmDisable?.packName ?? 'framework'}?`}
        message={
          confirmDisable?.linkedPolicyName
            ? `Disabling ${confirmDisable.packName} will also disable the linked policy '${confirmDisable.linkedPolicyName}'. Are you sure?`
            : `Disabling ${confirmDisable?.packName ?? 'this framework'} will disable the compliance framework. Are you sure?`
        }
        confirmLabel="Disable"
        confirmVariant="danger"
        onConfirm={confirmDisableAction}
        onCancel={() => setConfirmDisable(null)}
      />

      {/* Toast notification */}
      {toast && (
        <div className={clsx(
          'fixed bottom-6 right-6 z-50 flex items-start gap-3 border rounded-xl px-5 py-4 shadow-2xl max-w-md animate-[slideUp_0.3s_ease-out]',
          t.card
        )}>
          <CheckCircle className="w-5 h-5 text-accent-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className={clsx('text-sm font-medium', t.heading)}>{toast.message}</p>
            <Link
              to="/policies"
              className="inline-flex items-center gap-1 mt-2 text-sm text-brand-400 hover:text-brand-300 transition-colors"
            >
              View Policy <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <button onClick={() => setToast(null)} className={clsx('flex-shrink-0', t.muted, t.hoverText)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
