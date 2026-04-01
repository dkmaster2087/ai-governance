import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, GripVertical, ChevronDown, ChevronUp, Cpu } from 'lucide-react';
import clsx from 'clsx';
import { Toggle } from '../ui/Toggle';
import { useTheme } from '../../lib/theme';
import { themeClasses } from '../../lib/theme-classes';
import { fetchModelConfigs } from '../../lib/api';
import { mockModelConfigs } from '../../lib/mock-data';

export type RuleType =
  | 'keyword_block'
  | 'pii_detection'
  | 'model_restriction'
  | 'data_classification'
  | 'rate_limit'
  | 'cost_limit'
  | 'region_restriction'
  | 'audit_logging';

export type RuleAction = 'block' | 'mask' | 'warn' | 'allow';

export interface PolicyRule {
  ruleId: string;
  type: RuleType;
  action: RuleAction;
  priority: number;
  enabled: boolean;
  description: string;
  config: Record<string, unknown>;
}

interface Props {
  rules: PolicyRule[];
  onChange: (rules: PolicyRule[]) => void;
}

const RULE_TYPES: { value: RuleType; label: string; defaultAction: RuleAction; description: string }[] = [
  { value: 'keyword_block',       label: 'Keyword Block',       defaultAction: 'block', description: 'Block prompts containing specific words' },
  { value: 'pii_detection',       label: 'PII Detection',       defaultAction: 'mask',  description: 'Detect and mask personal information' },
  { value: 'model_restriction',   label: 'Model Restriction',   defaultAction: 'block', description: 'Restrict which AI models can be used' },
  { value: 'data_classification', label: 'Data Classification', defaultAction: 'warn',  description: 'Flag prompts matching sensitive patterns' },
  { value: 'rate_limit',          label: 'Rate Limit',          defaultAction: 'block', description: 'Enforce request rate limits' },
  { value: 'cost_limit',          label: 'Cost Limit',          defaultAction: 'warn',  description: 'Alert when cost thresholds are exceeded' },
  { value: 'region_restriction',  label: 'Region Restriction',  defaultAction: 'block', description: 'Restrict which AWS regions can be used' },
  { value: 'audit_logging',       label: 'Audit Logging',       defaultAction: 'allow', description: 'Configure audit logging behaviour' },
];

const ACTION_COLORS: Record<RuleAction, string> = {
  block: 'text-red-400 bg-red-500/20',
  mask:  'text-blue-400 bg-blue-500/20',
  warn:  'text-yellow-400 bg-yellow-500/20',
  allow: '',
};

const DEFAULT_CONFIGS: Record<RuleType, Record<string, unknown>> = {
  keyword_block:       { keywords: [] },
  pii_detection:       {},
  model_restriction:   { allowedModels: [] },
  data_classification: { patterns: [] },
  rate_limit:          { requestsPerMinute: 60, requestsPerDay: 10000 },
  cost_limit:          { monthlyLimitUSD: 500, alertThresholdPercent: 80 },
  region_restriction:  { allowedRegions: ['us-east-1'] },
  audit_logging:       { logLevel: 'full' },
};

const BEDROCK_MODELS = [
  'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'anthropic.claude-3-sonnet-20240229-v1:0',
  'anthropic.claude-3-haiku-20240307-v1:0',
  'amazon.titan-text-express-v1',
  'meta.llama3-70b-instruct-v1:0',
];

function newRule(priority: number): PolicyRule {
  return {
    ruleId: `rule_${Date.now()}`,
    type: 'keyword_block',
    action: 'block',
    priority,
    enabled: true,
    description: '',
    config: { keywords: [] },
  };
}

// ── Model restriction config with live model list ─────────────────────────
function ModelRestrictionConfig({ allowedModels, onChange }: { allowedModels: string[]; onChange: (models: string[]) => void }) {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);

  const { data } = useQuery({
    queryKey: ['model-configs'],
    queryFn: fetchModelConfigs,
    placeholderData: mockModelConfigs,
  });

  const models: typeof mockModelConfigs = Array.isArray(data) && data.length ? data : mockModelConfigs;

  const toggleModel = (modelId: string) => {
    if (allowedModels.includes(modelId)) {
      onChange(allowedModels.filter((m) => m !== modelId));
    } else {
      onChange([...allowedModels, modelId]);
    }
  };

  const selectAllActive = () => {
    const activeIds = models.filter((m) => m.status === 'active').map((m) => m.modelId);
    onChange(activeIds);
  };

  const statusColor: Record<string, string> = {
    active: 'text-accent-400',
    inactive: isDark ? 'text-slate-500' : 'text-gray-400',
    testing: 'text-yellow-400',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className={clsx('text-xs', t.muted)}>Select which configured models are allowed</p>
        <button onClick={selectAllActive} className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
          Select all active
        </button>
      </div>

      {models.length === 0 ? (
        <p className={clsx('text-xs py-3', t.faint)}>No models configured. Go to Models page to add some.</p>
      ) : (
        <div className="space-y-1.5">
          {models.map((model) => {
            const checked = allowedModels.includes(model.modelId);
            const isActive = model.status === 'active';
            return (
              <label
                key={model.modelConfigId}
                className={clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors border',
                  checked ? (isDark ? 'bg-brand-600/10 border-brand-500/30' : 'bg-brand-50 border-brand-200') : clsx(t.cardInner, t.border, 'hover:border-brand-500/20'),
                  !isActive && 'opacity-60'
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleModel(model.modelId)}
                  className="w-3.5 h-3.5 rounded border-gray-400 text-brand-600 focus:ring-brand-500 flex-shrink-0"
                />
                <Cpu className={clsx('w-3.5 h-3.5 flex-shrink-0', statusColor[model.status] ?? t.muted)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={clsx('text-sm font-medium truncate', t.heading)}>{model.name}</span>
                    <span className={clsx('text-xs px-1.5 py-0.5 rounded-full', statusColor[model.status] ?? t.muted, isActive ? 'bg-accent-500/10' : (isDark ? 'bg-slate-700' : 'bg-gray-200'))}>
                      {model.status}
                    </span>
                  </div>
                  <p className={clsx('text-xs font-mono truncate', t.muted)}>{model.modelId}</p>
                </div>
              </label>
            );
          })}
        </div>
      )}

      {allowedModels.length > 0 && (
        <p className={clsx('text-xs mt-2', t.sub)}>
          {allowedModels.length} model{allowedModels.length !== 1 ? 's' : ''} allowed
        </p>
      )}
      {allowedModels.length === 0 && models.length > 0 && (
        <p className="text-xs mt-2 text-red-400">No models selected — all requests will be blocked</p>
      )}
    </div>
  );
}

// ── Individual rule row ───────────────────────────────────────────────────────
function RuleRow({
  rule,
  index,
  total,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  rule: PolicyRule;
  index: number;
  total: number;
  onChange: (r: PolicyRule) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const [expanded, setExpanded] = useState(true);
  const [kwInput, setKwInput] = useState('');

  const allowActionColor = clsx(isDark ? 'text-slate-400 bg-slate-700' : 'text-gray-500 bg-gray-200');

  const set = (key: keyof PolicyRule, value: unknown) => onChange({ ...rule, [key]: value });
  const setConfig = (key: string, value: unknown) => onChange({ ...rule, config: { ...rule.config, [key]: value } });

  const addKeyword = () => {
    if (!kwInput.trim()) return;
    const kws = [...((rule.config.keywords as string[]) ?? []), kwInput.trim()];
    setConfig('keywords', kws);
    setKwInput('');
  };

  const removeKeyword = (kw: string) =>
    setConfig('keywords', ((rule.config.keywords as string[]) ?? []).filter((k) => k !== kw));

  return (
    <div className={clsx(
      'border rounded-xl overflow-hidden transition-colors',
      rule.enabled
        ? clsx(t.border, isDark ? 'bg-slate-800/40' : 'bg-gray-100')
        : clsx(isDark ? 'border-white/5 bg-slate-900/40' : 'border-gray-100 bg-gray-50/40', 'opacity-60')
    )}>
      {/* Rule header */}
      <div className="flex items-center gap-2 px-4 py-3">
        {/* Drag handle + reorder */}
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          <button onClick={onMoveUp} disabled={index === 0} className={clsx(t.faint, isDark ? 'hover:text-slate-400' : 'hover:text-gray-500', 'disabled:opacity-20 transition-colors')} aria-label="Move up">
            <ChevronUp className="w-3 h-3" />
          </button>
          <button onClick={onMoveDown} disabled={index === total - 1} className={clsx(t.faint, isDark ? 'hover:text-slate-400' : 'hover:text-gray-500', 'disabled:opacity-20 transition-colors')} aria-label="Move down">
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>

        <span className={clsx('text-xs w-5 text-center flex-shrink-0', t.faint)}>{index + 1}</span>

        {/* Type selector */}
        <select
          value={rule.type}
          onChange={(e) => {
            const tp = e.target.value as RuleType;
            const meta = RULE_TYPES.find((r) => r.value === tp)!;
            onChange({ ...rule, type: tp, action: meta.defaultAction, config: DEFAULT_CONFIGS[tp] });
          }}
          className={clsx('border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-brand-500 flex-shrink-0', t.card, t.border, t.heading)}
        >
          {RULE_TYPES.map((tp) => (
            <option key={tp.value} value={tp.value}>{tp.label}</option>
          ))}
        </select>

        {/* Action selector */}
        <select
          value={rule.action}
          onChange={(e) => set('action', e.target.value)}
          className={clsx(
            'border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-brand-500 flex-shrink-0',
            ACTION_COLORS[rule.action] || allowActionColor,
            'bg-transparent border-current/30'
          )}
        >
          <option value="block">Block</option>
          <option value="mask">Mask</option>
          <option value="warn">Warn</option>
          <option value="allow">Allow</option>
        </select>

        {/* Description */}
        <input
          type="text"
          value={rule.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Rule description..."
          className={clsx('flex-1 bg-transparent border-b px-1 py-1 text-sm focus:outline-none focus:border-brand-500 min-w-0', t.border, t.heading, isDark ? 'placeholder-slate-600' : 'placeholder-gray-400')}
        />

        {/* Enabled toggle */}
        <Toggle size="sm" checked={rule.enabled} onChange={(v) => set('enabled', v)} label="Toggle rule" />

        {/* Expand / delete */}
        <button onClick={() => setExpanded(!expanded)} className={clsx('transition-colors flex-shrink-0', t.muted, t.hoverText)}>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <button onClick={onDelete} className={clsx('hover:text-red-400 transition-colors flex-shrink-0', t.faint)} aria-label="Delete rule">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Rule config */}
      {expanded && (
        <div className={clsx('px-4 pb-4 pt-1 border-t', t.borderLight)}>
          {rule.type === 'keyword_block' && (
            <div>
              <p className={clsx('text-xs mb-2', t.muted)}>Keywords to block (press Enter to add)</p>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={kwInput}
                  onChange={(e) => setKwInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                  placeholder="e.g. confidential, top secret"
                  className={clsx('flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.card, t.border, t.heading, isDark ? 'placeholder-slate-600' : 'placeholder-gray-400')}
                />
                <button onClick={addKeyword} className="px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs transition-colors">
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {((rule.config.keywords as string[]) ?? []).map((kw) => (
                  <span
                    key={kw}
                    onClick={() => removeKeyword(kw)}
                    className={clsx('text-xs hover:bg-red-500/20 hover:text-red-400 px-2.5 py-1 rounded-full font-mono cursor-pointer transition-colors', isDark ? 'bg-slate-700' : 'bg-gray-200', t.body)}
                  >
                    {kw} ×
                  </span>
                ))}
                {((rule.config.keywords as string[]) ?? []).length === 0 && (
                  <span className={clsx('text-xs', t.faint)}>No keywords added yet</span>
                )}
              </div>
            </div>
          )}

          {rule.type === 'pii_detection' && (
            <p className={clsx('text-xs', t.muted)}>
              Automatically detects emails, phone numbers, SSNs, credit cards, and more using regex + Amazon Comprehend.
              No additional configuration required.
            </p>
          )}

          {rule.type === 'model_restriction' && (
            <ModelRestrictionConfig
              allowedModels={(rule.config.allowedModels as string[]) ?? []}
              onChange={(models) => setConfig('allowedModels', models)}
            />
          )}

          {rule.type === 'data_classification' && (
            <div>
              <p className={clsx('text-xs mb-2', t.muted)}>Regex patterns to match (one per line)</p>
              <textarea
                rows={3}
                value={((rule.config.patterns as string[]) ?? []).join('\n')}
                onChange={(e) => setConfig('patterns', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                className={clsx('w-full border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-brand-500 resize-none', t.card, t.border, t.heading)}
                placeholder="password\napi.?key\ninternal only"
              />
            </div>
          )}

          {rule.type === 'rate_limit' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={clsx('block text-xs mb-1', t.muted)}>Requests / minute</label>
                <input type="number" value={(rule.config.requestsPerMinute as number) ?? 60}
                  onChange={(e) => setConfig('requestsPerMinute', +e.target.value)}
                  className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.card, t.border, t.heading)} />
              </div>
              <div>
                <label className={clsx('block text-xs mb-1', t.muted)}>Requests / day</label>
                <input type="number" value={(rule.config.requestsPerDay as number) ?? 10000}
                  onChange={(e) => setConfig('requestsPerDay', +e.target.value)}
                  className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.card, t.border, t.heading)} />
              </div>
            </div>
          )}

          {rule.type === 'cost_limit' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={clsx('block text-xs mb-1', t.muted)}>Monthly limit (USD)</label>
                <input type="number" value={(rule.config.monthlyLimitUSD as number) ?? 500}
                  onChange={(e) => setConfig('monthlyLimitUSD', +e.target.value)}
                  className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.card, t.border, t.heading)} />
              </div>
              <div>
                <label className={clsx('block text-xs mb-1', t.muted)}>Alert at (%)</label>
                <input type="number" min="1" max="100" value={(rule.config.alertThresholdPercent as number) ?? 80}
                  onChange={(e) => setConfig('alertThresholdPercent', +e.target.value)}
                  className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.card, t.border, t.heading)} />
              </div>
            </div>
          )}

          {rule.type === 'region_restriction' && (
            <div>
              <p className={clsx('text-xs mb-2', t.muted)}>Allowed AWS regions (comma-separated)</p>
              <input
                type="text"
                value={((rule.config.allowedRegions as string[]) ?? []).join(', ')}
                onChange={(e) => setConfig('allowedRegions', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                placeholder="us-east-1, eu-west-1"
                className={clsx('w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.card, t.border, t.heading)}
              />
            </div>
          )}

          {rule.type === 'audit_logging' && (
            <div>
              <label className={clsx('block text-xs mb-1', t.muted)}>Log level</label>
              <select
                value={(rule.config.logLevel as string) ?? 'full'}
                onChange={(e) => setConfig('logLevel', e.target.value)}
                className={clsx('border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500', t.card, t.border, t.heading)}
              >
                <option value="full">Full (prompt + response)</option>
                <option value="metadata">Metadata only</option>
                <option value="violations_only">Violations only</option>
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────
export function PolicyRuleEditor({ rules, onChange }: Props) {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);

  const addRule = () => onChange([...rules, newRule(rules.length + 1)]);

  const updateRule = (idx: number, updated: PolicyRule) => {
    const next = [...rules];
    next[idx] = updated;
    onChange(next);
  };

  const deleteRule = (idx: number) => {
    onChange(rules.filter((_, i) => i !== idx).map((r, i) => ({ ...r, priority: i + 1 })));
  };

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = [...rules];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next.map((r, i) => ({ ...r, priority: i + 1 })));
  };

  const moveDown = (idx: number) => {
    if (idx === rules.length - 1) return;
    const next = [...rules];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onChange(next.map((r, i) => ({ ...r, priority: i + 1 })));
  };

  return (
    <div className="space-y-2">
      {rules.length === 0 && (
        <div className={clsx('text-center py-8 border border-dashed rounded-xl text-sm', t.border, t.faint)}>
          No rules yet — add one below
        </div>
      )}

      {rules.map((rule, idx) => (
        <RuleRow
          key={rule.ruleId}
          rule={rule}
          index={idx}
          total={rules.length}
          onChange={(r) => updateRule(idx, r)}
          onDelete={() => deleteRule(idx)}
          onMoveUp={() => moveUp(idx)}
          onMoveDown={() => moveDown(idx)}
        />
      ))}

      <button
        onClick={addRule}
        className={clsx(
          'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed text-sm transition-colors',
          isDark ? 'border-white/20 hover:border-white/40' : 'border-gray-300 hover:border-gray-400',
          t.muted, t.hoverText
        )}
      >
        <Plus className="w-4 h-4" />
        Add rule
      </button>
    </div>
  );
}
