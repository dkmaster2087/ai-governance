import { AuditLog } from '@ai-governance/types';
import type { ActivityRecord } from '../activity/activity-log';

/**
 * One shape for every record Probaline sends to a company's log tools, whatever the destination.
 * Fields are the same on every type, so one SIEM query covers decisions, admin activity and sign-ins.
 */
export const SCHEMA = 'probaline.log/1';

export type RecordType = 'decision' | 'admin_activity' | 'sign_in';
/** What a company chooses to send. */
export type RecordChoice = 'decisions' | 'admin_activity' | 'sign_ins';
export const RECORD_CHOICES: readonly RecordChoice[] = ['decisions', 'admin_activity', 'sign_ins'];

export interface ExportRecord {
  schema: typeof SCHEMA;
  id: string;
  type: RecordType | 'test';
  time: string;
  tenantId: string;
  /** `ai.request`, `mcp.tool_call`, `rule.created`, `sign_in.dashboard`… */
  action: string;
  /** decisions: allowed | stopped. activity: success | denied | failure. */
  outcome: string;
  actor: { type: string; id: string; email?: string; role?: string; keyId?: string; appId?: string };
  target?: Record<string, string>;
  requestId?: string;
  source?: { ip?: string; userAgent?: string };
  detail: Record<string, unknown>;
}

const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;

/**
 * A decision record. Prompts and answers are never sent (Probaline keeps only their fingerprints), and
 * neither is the stop excerpt, which is cut from the prompt: the reason and the rule are enough to alert on.
 */
export function fromDecision(log: AuditLog): ExportRecord {
  const m = log.metadata ?? {};
  const mcp = m.kind === 'mcp_tool_call';
  return {
    schema: SCHEMA,
    id: log.logId || log.requestId,
    type: 'decision',
    time: log.timestamp,
    tenantId: log.tenantId,
    action: mcp ? 'mcp.tool_call' : 'ai.request',
    outcome: log.eventType === 'request_blocked' ? 'stopped' : 'allowed',
    actor: defined({ type: mcp && m.caller === 'person' ? 'person' : 'app_user', id: log.userId || 'anonymous', appId: log.appId || undefined }),
    target: defined(mcp
      ? { server: m.mcpServer, tool: m.mcpTool, api: m.mcpApi }
      : { provider: log.provider, model: log.modelId }) as unknown as Record<string, string>,
    requestId: log.requestId,
    detail: defined({
      check: m.check,
      reason: m.policyReason,
      ruleType: m.ruleType,
      triggeredRules: log.triggeredRules?.length ? log.triggeredRules : undefined,
      personalDataRemoved: log.piiDetected || undefined,
      secretsRedacted: m.secretsRedacted ? true : undefined,
      inputTokens: log.inputTokens || undefined,
      outputTokens: log.outputTokens || undefined,
      estimatedCostUsd: log.estimatedCost || undefined,
      latencyMs: log.latencyMs,
      promptFingerprint: log.promptHash || undefined,
      approvalId: m.approvalId,
      backendStatus: m.backendStatus ? Number(m.backendStatus) : undefined,
      backendError: m.backendError,
    }),
  };
}

export function fromActivity(rec: ActivityRecord): ExportRecord {
  return {
    schema: SCHEMA,
    id: rec.eventId,
    type: rec.category === 'sign_in' ? 'sign_in' : 'admin_activity',
    time: rec.time,
    tenantId: rec.tenantId,
    action: rec.action,
    outcome: rec.outcome,
    actor: rec.actor,
    ...(rec.target ? { target: rec.target } : {}),
    ...(rec.requestId ? { requestId: rec.requestId } : {}),
    ...(rec.sourceIp || rec.userAgent ? { source: defined({ ip: rec.sourceIp, userAgent: rec.userAgent }) } : {}),
    detail: { ...(rec.detail ?? {}), recordHash: rec.hash },
  };
}

/** What the test button sends. */
export function sampleRecord(tenantId: string, by: string): ExportRecord {
  return {
    schema: SCHEMA,
    id: `test_${Date.now().toString(36)}`,
    type: 'test',
    time: new Date().toISOString(),
    tenantId,
    action: 'log_export.test',
    outcome: 'success',
    actor: { type: 'user', id: by },
    detail: { message: 'Test record from Probaline log export. Real records have the same fields.' },
  };
}
