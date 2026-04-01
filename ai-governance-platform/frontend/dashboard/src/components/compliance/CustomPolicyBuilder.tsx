import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { createPolicy } from '../../lib/api';
import { CONTROL_DETAILS } from '../../lib/control-details';
import { useTheme } from '../../lib/theme';
import { themeClasses } from '../../lib/theme-classes';

type RuleType = 'keyword_block' | 'pii_detection' | 'model_restriction' | 'data_classification' | 'rate_limit' | 'cost_limit' | 'audit_logging' | 'region_restriction' | 'encryption' | 'access_control';
type RuleAction = 'block' | 'mask' | 'warn' | 'allow';

interface CustomRule {
  id: string;
  ruleId: string;
  type: RuleType;
  action: RuleAction;
  priority: number;
  enabled: boolean;
  description: string;
  config: Record<string, unknown>;
  sourceControlId?: string;
}

interface Props {
  preloadedControlIds?: string[];
  onClose: () => void;
  onSaved: () => void;
}

const RULE_TYPE_OPTIONS: { value: RuleType; label: string; description: string }[] = [
  { value: 'keyword_block',      label: 'Keyword Block',       description: 'Block prompts containing specific words or phrases' },
  { value: 'pii_detection',      label: 'PII Detection',       description: 'Detect and mask/block personal information' },
  { value: 'model_restriction',  label: 'Model Restriction',   description: 'Restrict which AI models can be used' },
  { value: 'data_classification',label: 'Data Classification', description: 'Flag prompts matching sensitive data patterns' },
  { value: 'rate_limit',         label: 'Rate Limit',          description: 'Enforce request rate limits' },
  { value: 'cost_limit',         label: 'Cost Limit',          description: 'Alert or block when cost thresholds are exceeded' },
  { value: 'region_restriction', label: 'Region Restriction',  description: 'Restrict which AWS regions AI requests can use' },
  { value: 'audit_logging',      label: 'Audit Logging',       description: 'Configure what gets logged for compliance' },
];

const DEFAULT_CONFIGS: Record<RuleType, Record<string, unknown>> = {
  keyword_block:       { keywords: [] },
  pii_detection:       {},
  model_restriction:   { allowedModels: [] },
  data_classification: { patterns: [] },
  rate_limit:          { requestsPerMinute: 60 },
  cost_limit:          { monthlyLimitUSD: 500 },
  region_restriction:  { allowedRegions: ['us-east-1'] },
  audit_logging:       { logLevel: 'full' },
  encryption:          { requireTls: true },
  access_control:      { requireApiKey: true },
};

function buildRuleFromControl(controlId: string): CustomRule | null {
  const detail = CONTROL_DETAILS[controlId];
  if (!detail) return null;
  return {
    id: crypto.randomUUID(),
    ruleId: `rule_${controlId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
    type: (detail.ruleConfig.type as RuleType) ?? 'audit_logging',
    action: (detail.ruleConfig.action as RuleAction) ?? 'allow',
    priority: 1,
    enabled: true,
    description: `Copied from ${controlId}`,
    config: (detail.ruleConfig.config as Record<string, unknown>) ?? {},
    sourceControlId: controlId,
  };
}

export function CustomPolicyBuilder({ preloadedControlIds = [], onClose, onSaved }: Props) {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState<CustomRule[]>(() =>
    preloadedControlIds.map(buildRuleFromControl).filter(Boolean) as CustomRule[]
  );
  const [addingRule, setAddingRule] = useState(false);
  const [newRule, setNewRule] = useState<Partial<CustomRule>>({
    type: 'keyword_block', action: 'block', priority: rules.length + 1,
    enabled: true, description: '', config: { keywords: [] },
  });
  const [keywordInput, setKeywordInput] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      createPolicy({
        tenantId: 'tenant_demo',
        name,
        description,
        enabled: true,
        createdBy: 'admin',
        rules: rules.map(({ id, ...r }) => ({
          ...r,
          ruleId: r.ruleId || `rule_${Date.now()}`,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      onSaved();
    },
  });

  const removeRule = (id: string) => setRules((r) => r.filter((x) => x.id !== id));

  const commitNewRule = () => {
    if (!newRule.description) return;
    setRules((r) => [
      ...r,
      {
        id: crypto.randomUUID(),
        ruleId: `rule_custom_${Date.now()}`,
        type: newRule.type ?? 'keyword_block',
        action: newRule.action ?? 'block',
        priority: r.length + 1,
        enabled: true,
        description: newRule.description ?? '',
        config: newRule.config ?? {},
      },
    ]);
    setAddingRule(false);
    setNewRule({ type: 'keyword_block', action: 'block', enabled: true, description: '', config: { keywords: [] } });
    setKeywordInput('');
  };

  const handleTypeChange = (type: RuleType) => {
    setNewRule((r) => ({ ...r, type, config: DEFAULT_CONFIGS[type] ?? {} }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className={clsx('relative border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl', t.overlay)}>
        {/* Header */}
        <div className={clsx('flex items-center justify-between px-6 py-5 border-b', t.border)}>
          <div>
            <h2 className={clsx('text-lg font-semibold', t.heading)}>Custom Policy Builder</h2>
            <p className={clsx('text-xs mt-0.5', t.muted)}>
              {preloadedControlIds.length > 0
                ? `${preloadedControlIds.length} control${preloadedControlIds.length > 1 ? 's' : ''} pre-loaded from framework`
                : 'Build a policy from scratch or add controls from compliance frameworks'}
            </p>
          </div>
          <button onClick={onClose} className={clsx(t.muted, t.hoverText)} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-5">
          {/* Policy name & description */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={clsx('block text-sm mb-1.5', t.sub)} htmlFor="cp-name">Policy name</label>
              <input
                id="cp-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. GDPR + Custom Controls"
                className={clsx('w-full border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-brand-500', t.input)}
              />
            </div>
            <div className="col-span-2">
              <label className={clsx('block text-sm mb-1.5', t.sub)} htmlFor="cp-desc">Description</label>
              <textarea
                id="cp-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this policy enforce?"
                className={clsx('w-full border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-brand-500 resize-none', t.input)}
              />
            </div>
          </div>

          {/* Rules list */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className={clsx('text-sm font-medium', t.heading)}>
                Rules <span className={clsx('font-normal', t.muted)}>({rules.length})</span>
              </h3>
            </div>

            {rules.length === 0 && !addingRule && (
              <div className={clsx('text-center py-8 border border-dashed rounded-xl text-sm', t.border, t.faint)}>
                No rules yet — add one below or copy from a compliance framework
              </div>
            )}

            <div className="space-y-2">
              {rules.map((rule, idx) => (
                <div key={rule.id} className={clsx('flex items-start gap-3 border rounded-xl p-3', isDark ? 'bg-slate-800/60' : 'bg-gray-100', t.border)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs bg-brand-600/20 text-brand-400 px-2 py-0.5 rounded-full font-medium">
                        {rule.type.replace(/_/g, ' ')}
                      </span>
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
                        rule.action === 'block' ? 'bg-red-500/20 text-red-400' :
                        rule.action === 'mask'  ? 'bg-blue-500/20 text-blue-400' :
                        rule.action === 'warn'  ? 'bg-yellow-500/20 text-yellow-400' :
                        clsx(isDark ? 'bg-slate-700' : 'bg-gray-200', t.sub)
                      )}>
                        {rule.action}
                      </span>
                      <span className={clsx('text-xs', t.faint)}>Priority {idx + 1}</span>
                      {rule.sourceControlId && (
                        <span className={clsx('text-xs font-mono', t.faint)}>← {rule.sourceControlId}</span>
                      )}
                    </div>
                    <p className={clsx('text-sm', t.body)}>{rule.description}</p>
                    {Array.isArray(rule.config.keywords) && (rule.config.keywords as string[]).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {(rule.config.keywords as string[]).map((kw: string) => (
                          <span key={kw} className={clsx('text-xs px-1.5 py-0.5 rounded font-mono', isDark ? 'bg-slate-700' : 'bg-gray-200', t.sub)}>{kw}</span>
                        ))}
                      </div>
                    )}
                    {Array.isArray(rule.config.allowedModels) && (
                      <p className={clsx('text-xs mt-1', t.muted)}>
                        Models: {(rule.config.allowedModels as string[]).join(', ') || 'none configured'}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => removeRule(rule.id)}
                    className={clsx('hover:text-red-400 transition-colors flex-shrink-0', t.faint)}
                    aria-label="Remove rule"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add new rule form */}
            {addingRule ? (
              <div className={clsx('mt-3 border border-brand-500/30 rounded-xl p-4 space-y-3', isDark ? 'bg-slate-800/40' : 'bg-gray-100')}>
                <p className={clsx('text-sm font-medium', t.heading)}>New Rule</p>

                {/* Type selector */}
                <div>
                  <label className={clsx('block text-xs mb-1.5', t.muted)}>Rule type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {RULE_TYPE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleTypeChange(opt.value)}
                        className={clsx('text-left px-3 py-2 rounded-lg border text-xs transition-colors',
                          newRule.type === opt.value
                            ? 'border-brand-500 bg-brand-600/20 text-brand-300'
                            : clsx('border', t.border, t.cardInner, t.sub, isDark ? 'hover:border-white/20' : 'hover:border-gray-300')
                        )}
                      >
                        <p className="font-medium">{opt.label}</p>
                        <p className={clsx('mt-0.5 leading-tight', t.faint)}>{opt.description}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Action */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={clsx('block text-xs mb-1.5', t.muted)}>Action</label>
                    <select
                      value={newRule.action}
                      onChange={(e) => setNewRule((r) => ({ ...r, action: e.target.value as RuleAction }))}
                      className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.card, t.border, t.heading)}
                    >
                      <option value="block">Block</option>
                      <option value="mask">Mask</option>
                      <option value="warn">Warn</option>
                      <option value="allow">Allow (log only)</option>
                    </select>
                  </div>
                  <div>
                    <label className={clsx('block text-xs mb-1.5', t.muted)}>Description</label>
                    <input
                      type="text"
                      value={newRule.description}
                      onChange={(e) => setNewRule((r) => ({ ...r, description: e.target.value }))}
                      placeholder="What does this rule do?"
                      className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.card, t.border, t.heading)}
                    />
                  </div>
                </div>

                {/* Type-specific config */}
                {newRule.type === 'keyword_block' && (
                  <div>
                    <label className={clsx('block text-xs mb-1.5', t.muted)}>Keywords to block</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={keywordInput}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && keywordInput.trim()) {
                            setNewRule((r) => ({
                              ...r,
                              config: { keywords: [...((r.config?.keywords as string[]) ?? []), keywordInput.trim()] },
                            }));
                            setKeywordInput('');
                          }
                        }}
                        placeholder="Type keyword and press Enter"
                        className={clsx('flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.card, t.border, t.heading)}
                      />
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {((newRule.config?.keywords as string[]) ?? []).map((kw) => (
                        <span
                          key={kw}
                          className={clsx('text-xs px-2 py-0.5 rounded-full font-mono cursor-pointer hover:bg-red-500/20 hover:text-red-400', isDark ? 'bg-slate-700' : 'bg-gray-200', t.body)}
                          onClick={() => setNewRule((r) => ({
                            ...r,
                            config: { keywords: ((r.config?.keywords as string[]) ?? []).filter((k) => k !== kw) },
                          }))}
                        >
                          {kw} ×
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {newRule.type === 'model_restriction' && (
                  <div>
                    <label className={clsx('block text-xs mb-1.5', t.muted)}>Allowed models (one per line)</label>
                    <textarea
                      rows={3}
                      value={((newRule.config?.allowedModels as string[]) ?? []).join('\n')}
                      onChange={(e) => setNewRule((r) => ({
                        ...r,
                        config: { allowedModels: e.target.value.split('\n').filter(Boolean) },
                      }))}
                      placeholder="anthropic.claude-3-haiku-20240307-v1:0"
                      className={clsx('w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-brand-500 resize-none', t.card, t.border, t.heading)}
                    />
                  </div>
                )}

                {newRule.type === 'rate_limit' && (
                  <div>
                    <label className={clsx('block text-xs mb-1.5', t.muted)}>Requests per minute</label>
                    <input
                      type="number"
                      value={(newRule.config?.requestsPerMinute as number) ?? 60}
                      onChange={(e) => setNewRule((r) => ({ ...r, config: { requestsPerMinute: +e.target.value } }))}
                      className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.card, t.border, t.heading)}
                    />
                  </div>
                )}

                {newRule.type === 'region_restriction' && (
                  <div>
                    <label className={clsx('block text-xs mb-1.5', t.muted)}>Allowed regions (comma-separated)</label>
                    <input
                      type="text"
                      value={((newRule.config?.allowedRegions as string[]) ?? []).join(', ')}
                      onChange={(e) => setNewRule((r) => ({
                        ...r,
                        config: { allowedRegions: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) },
                      }))}
                      placeholder="us-east-1, eu-west-1"
                      className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.card, t.border, t.heading)}
                    />
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => { setAddingRule(false); setKeywordInput(''); }}
                    className={clsx('flex-1 py-2 rounded-lg text-sm transition-colors', t.btnSecondary)}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={commitNewRule}
                    disabled={!newRule.description}
                    className="flex-1 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    Add Rule
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingRule(true)}
                className={clsx(
                  'mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed text-sm transition-colors',
                  isDark ? 'border-white/20 hover:border-white/40' : 'border-gray-300 hover:border-gray-400',
                  t.muted, t.hoverText
                )}
              >
                <Plus className="w-4 h-4" />
                Add new rule
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={clsx('px-6 py-4 border-t flex gap-3', t.border)}>
          <button onClick={onClose} className={clsx('flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors', t.btnSecondary)}>
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name || rules.length === 0 || mutation.isPending}
            className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {mutation.isPending ? 'Saving...' : `Save Policy (${rules.length} rule${rules.length !== 1 ? 's' : ''})`}
          </button>
        </div>
      </div>
    </div>
  );
}
