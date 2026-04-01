export type PolicyAction = 'allow' | 'block' | 'mask' | 'warn' | 'redact';
export type PolicyRuleType =
  | 'keyword_block'
  | 'pii_detection'
  | 'model_restriction'
  | 'rate_limit'
  | 'data_classification'
  | 'region_restriction'
  | 'cost_limit';

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
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  action: PolicyAction;
  triggeredRules: string[];
  maskedContent?: string;
  reason?: string;
  riskScore: number;
}
