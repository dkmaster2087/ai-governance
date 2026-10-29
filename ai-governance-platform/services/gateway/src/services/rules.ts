import { randomBytes } from 'crypto';
import { AuditLog, Policy, PolicyRule, PolicyRuleType } from '@ai-governance/types';

/** Rule types the gateway actually evaluates on each request. */
export const ENFORCEABLE_TYPES: PolicyRuleType[] = ['keyword_block', 'model_restriction', 'data_classification', 'pii_detection'];

/**
 * - stops: evaluated on every request and blocks on a match.
 * - flags: evaluated, but its action doesn't stop the request.
 * - not_enforced: recorded (often from a compliance pack) but not checked by the gateway.
 */
export type RuleEffect = 'stops' | 'flags' | 'not_enforced';

export function ruleEffect(rule: Pick<PolicyRule, 'type' | 'action'>): RuleEffect {
  if (!ENFORCEABLE_TYPES.includes(rule.type)) return 'not_enforced';
  return rule.action === 'block' ? 'stops' : 'flags';
}

export interface RuleView {
  ruleId: string;
  policyId: string;
  policyName: string;
  framework?: string;
  type: PolicyRuleType;
  action: PolicyRule['action'];
  description: string;
  config: Record<string, unknown>;
  /** On only when both the rule and its policy are on. */
  enabled: boolean;
  policyEnabled: boolean;
  effect: RuleEffect;
  stopped: number;
  flagged: number;
}

/** Flatten a tenant's policies into rules, with what each did in the audit window. */
export function buildRuleViews(policies: Policy[], logs: AuditLog[]): RuleView[] {
  const stopped = new Map<string, number>();
  const flagged = new Map<string, number>();
  for (const l of logs) {
    const rules = l.triggeredRules ?? [];
    const stopper = l.eventType === 'request_blocked' ? rules[rules.length - 1] : undefined;
    if (stopper) stopped.set(stopper, (stopped.get(stopper) ?? 0) + 1);
    for (const r of rules) if (r !== stopper) flagged.set(r, (flagged.get(r) ?? 0) + 1);
  }
  return policies.flatMap((p) =>
    p.rules.map((r) => ({
      ruleId: r.ruleId,
      policyId: p.policyId,
      policyName: p.name,
      framework: p.sourceFramework,
      type: r.type,
      action: r.action,
      description: r.description,
      config: r.config ?? {},
      enabled: r.enabled && p.enabled,
      policyEnabled: p.enabled,
      effect: ruleEffect(r),
      stopped: stopped.get(r.ruleId) ?? 0,
      flagged: flagged.get(r.ruleId) ?? 0,
    }))
  );
}

export interface RuleInput {
  type: 'keyword_block' | 'model_restriction' | 'data_classification' | 'pii_detection';
  description: string;
  /** keywords, allowed models, patterns, or personal-data types, depending on type. */
  values: string[];
}

const CONFIG_KEY: Record<RuleInput['type'], string> = {
  keyword_block: 'keywords',
  model_restriction: 'allowedModels',
  data_classification: 'patterns',
  pii_detection: 'piiTypes',
};

export const PII_TYPES = ['EMAIL', 'PHONE', 'SSN', 'CREDIT_CARD', 'NAME', 'DATE_OF_BIRTH', 'MEDICAL_RECORD_NUMBER'];

export function valuesOf(rule: Pick<PolicyRule, 'type' | 'config'>): string[] {
  const key = CONFIG_KEY[rule.type as RuleInput['type']];
  const v = key ? rule.config?.[key] : undefined;
  return Array.isArray(v) ? v.map(String) : [];
}

export function newRule(input: RuleInput, existing: PolicyRule[]): PolicyRule {
  return {
    ruleId: `rule_${randomBytes(5).toString('hex')}`,
    type: input.type,
    action: 'block',
    priority: Math.max(0, ...existing.map((r) => r.priority)) + 1,
    enabled: true,
    description: input.description,
    config: { [CONFIG_KEY[input.type]]: input.values },
  };
}

export interface RuleChange {
  enabled?: boolean;
  description?: string;
  values?: string[];
}

/** The policy with one rule changed, or null if the rule isn't in it. */
export function applyRuleChange(policy: Policy, ruleId: string, change: RuleChange): Policy | null {
  const rule = policy.rules.find((r) => r.ruleId === ruleId);
  if (!rule) return null;
  const updated: PolicyRule = { ...rule };
  if (change.enabled !== undefined) updated.enabled = change.enabled;
  if (change.description !== undefined) updated.description = change.description;
  if (change.values !== undefined) {
    const key = CONFIG_KEY[rule.type as RuleInput['type']];
    if (!key) return null;
    updated.config = { ...rule.config, [key]: change.values };
  }
  // A policy switched off as a whole is switched back on when one of its rules is turned on.
  const enabled = change.enabled ? true : policy.enabled;
  return { ...policy, enabled, rules: policy.rules.map((r) => (r.ruleId === ruleId ? updated : r)) };
}
