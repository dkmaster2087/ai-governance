import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { AI_TOOLS, toolById } from './ai-tools';

export type ToolDecision = 'blocked' | 'allowed';

/** A tenant's choices for AI tools reached outside the gateway. */
export interface ShadowAiPolicy {
  /** What the extension does for tools without a decision: just record visits, or block them. */
  mode: 'monitor' | 'block';
  decisions: Record<string, ToolDecision>;
}

export const DEFAULT_SHADOW_POLICY: ShadowAiPolicy = { mode: 'monitor', decisions: {} };

/** Stored on the tenant record so it moves with the tenant. */
export class ShadowAiPolicyStore {
  private client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
  private table = process.env.TENANTS_TABLE || 'ai-gov-tenants-dev';

  async get(tenantId: string): Promise<ShadowAiPolicy> {
    const result = await this.client.send(new GetCommand({ TableName: this.table, Key: { tenantId }, ProjectionExpression: 'shadowAi' }));
    const stored = result.Item?.shadowAi as Partial<ShadowAiPolicy> | undefined;
    return { mode: stored?.mode === 'block' ? 'block' : 'monitor', decisions: { ...(stored?.decisions ?? {}) } };
  }

  async save(tenantId: string, policy: ShadowAiPolicy): Promise<void> {
    await this.client.send(new UpdateCommand({
      TableName: this.table,
      Key: { tenantId },
      UpdateExpression: 'SET shadowAi = :p, updatedAt = :t',
      ConditionExpression: 'attribute_exists(tenantId)',
      ExpressionAttributeValues: { ':p': policy, ':t': new Date().toISOString() },
    }));
  }
}

/** Apply a change: a decision of null clears it (back to undecided). Unknown tool ids are rejected. */
export function applyPolicyChange(
  current: ShadowAiPolicy,
  change: { mode?: 'monitor' | 'block'; decisions?: Record<string, ToolDecision | null> }
): { policy: ShadowAiPolicy } | { error: string } {
  const decisions = { ...current.decisions };
  for (const [id, decision] of Object.entries(change.decisions ?? {})) {
    if (!toolById(id)) return { error: `Unknown tool: ${id}` };
    if (decision === null) delete decisions[id];
    else decisions[id] = decision;
  }
  return { policy: { mode: change.mode ?? current.mode, decisions } };
}

/** What the browser extension enforces, derived from the policy. */
export function extensionConfig(tenantId: string, policy: ShadowAiPolicy) {
  const domainsOf = (ids: string[]) => ids.flatMap((id) => toolById(id)?.domains ?? []);
  const decided = Object.keys(policy.decisions);
  const blocked = decided.filter((id) => policy.decisions[id] === 'blocked');
  const allowed = decided.filter((id) => policy.decisions[id] === 'allowed');
  const watched = [...new Set([...AI_TOOLS.flatMap((t) => t.domains), ...domainsOf(decided)])];
  return {
    tenantId,
    mode: policy.mode,
    // Domains the extension watches (name kept for older extension versions).
    blockedDomains: watched,
    // Always blocked, whatever the mode.
    enforcedDomains: domainsOf(blocked),
    // Never blocked or recorded.
    allowedDomains: domainsOf(allowed),
  };
}
