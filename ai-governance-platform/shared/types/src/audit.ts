export type AuditEventType =
  | 'request_received'
  | 'policy_evaluated'
  | 'pii_detected'
  | 'request_blocked'
  | 'request_allowed'
  | 'response_filtered'
  | 'provider_called'
  | 'error';

export interface AuditLog {
  logId: string;
  requestId: string;
  tenantId: string;
  userId: string;
  appId: string;
  eventType: AuditEventType;
  provider: string;
  modelId: string;
  promptHash: string;
  responseHash: string;
  policyDecision: string;
  triggeredRules: string[];
  piiDetected: boolean;
  piiTypes: string[];
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  latencyMs: number;
  timestamp: string;
  metadata: Record<string, string>;
}

export interface UsageMetrics {
  tenantId: string;
  period: string;
  totalRequests: number;
  blockedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  piiDetectionCount: number;
  modelBreakdown: Record<string, number>;
  providerBreakdown: Record<string, number>;
}
