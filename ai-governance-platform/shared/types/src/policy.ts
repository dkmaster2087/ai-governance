export type PolicyAction = 'allow' | 'block' | 'mask' | 'warn' | 'redact';
export type PolicyRuleType =
  | 'keyword_block'
  | 'pii_detection'
  | 'model_restriction'
  | 'rate_limit'
  | 'data_classification'
  | 'cost_limit'
  | 'transparency'
  | 'audit_logging'
  | 'access_control';

export interface PolicyRule {
  ruleId: string;
  type: PolicyRuleType;
  action: PolicyAction;
  priority: number;
  enabled: boolean;
  config: Record<string, unknown>;
  description: string;
}

export interface Policy {
  policyId: string;
  tenantId: string;
  name: string;
  description: string;
  enabled: boolean;
  rules: PolicyRule[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  sourceFramework?: string;
}

/**
 * What the stopping rule matched, as a short excerpt for evidence. Personal data around the match is
 * masked; when the match itself is personal data, `hit` is a label such as "[SSN]".
 */
export interface PolicyEvidence {
  ruleId: string;
  ruleType: PolicyRuleType;
  before: string;
  hit: string;
  after: string;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  action: PolicyAction;
  triggeredRules: string[];
  maskedContent?: string;
  reason?: string;
  riskScore: number;
  /** Present when a rule stopped the request. */
  evidence?: PolicyEvidence;
}
