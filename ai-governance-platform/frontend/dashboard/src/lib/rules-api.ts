import { createApiClient } from './http';

const gateway = createApiClient('/api');

export type RuleEffect = 'stops' | 'flags' | 'not_enforced';
export type EditableType = 'keyword_block' | 'model_restriction' | 'data_classification' | 'pii_detection';

/** Mirrors RuleView in services/gateway/src/services/rules.ts. */
export interface RuleView {
  ruleId: string;
  policyId: string;
  policyName: string;
  framework?: string;
  type: string;
  action: string;
  description: string;
  config: Record<string, unknown>;
  enabled: boolean;
  policyEnabled: boolean;
  effect: RuleEffect;
  stopped: number;
  flagged: number;
}

export interface RulesResponse {
  from: string;
  to: string;
  failMode: 'open' | 'closed';
  cleaned: number;
  piiTypes: string[];
  rules: RuleView[];
}

const CONFIG_KEY: Record<EditableType, string> = {
  keyword_block: 'keywords',
  model_restriction: 'allowedModels',
  data_classification: 'patterns',
  pii_detection: 'piiTypes',
};

export const isEditableType = (t: string): t is EditableType => t in CONFIG_KEY;

export function ruleValues(rule: Pick<RuleView, 'type' | 'config'>): string[] {
  const v = isEditableType(rule.type) ? rule.config[CONFIG_KEY[rule.type]] : undefined;
  return Array.isArray(v) ? v.map(String) : [];
}

export const fetchRules = async () => (await gateway.get<RulesResponse>('/v1/rules')).data;
export const addRule = async (input: { type: EditableType; description: string; values: string[] }) =>
  (await gateway.post('/v1/rules', input)).data;
export const changeRule = async (rule: RuleView, change: { enabled?: boolean; description?: string; values?: string[] }) =>
  (await gateway.patch(`/v1/rules/${encodeURIComponent(rule.policyId)}/${encodeURIComponent(rule.ruleId)}`, change)).data;
export const deleteRule = async (rule: RuleView) =>
  (await gateway.delete(`/v1/rules/${encodeURIComponent(rule.policyId)}/${encodeURIComponent(rule.ruleId)}`)).data;
export const setFailMode = async (governanceFailMode: 'open' | 'closed') =>
  (await gateway.put('/v1/gateway/settings', { governanceFailMode })).data;

/** The error message the gateway sent, if any. */
export function errorMessage(err: unknown): string {
  const e = err as { response?: { data?: { error?: string; message?: string } } };
  // Prefer the readable message; `error` is sometimes a machine code such as INVALID_RULES.
  return e.response?.data?.message ?? e.response?.data?.error ?? 'Something went wrong. Try again.';
}
