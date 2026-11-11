import { isMcpCall } from './evidence';
import { AuditLog } from '@ai-governance/types';

/** Spend views over a company's model traffic (estimated from tokens and each model's prices). */

type Totals = { cost: number; requests: number };
const group = (logs: AuditLog[], key: (l: AuditLog) => string) => {
  const out: Record<string, Totals> = {};
  for (const l of logs) {
    const k = key(l) || 'unknown';
    out[k] ??= { cost: 0, requests: 0 };
    out[k].cost += l.estimatedCost || 0;
    out[k].requests += 1;
  }
  return out;
};

export function costSummary(tenantId: string, logs: AuditLog[], fromIso: string, now = new Date()) {
  const totalCost = logs.reduce((sum, l) => sum + (l.estimatedCost || 0), 0);
  const days = Math.max(1, Math.ceil((now.getTime() - Date.parse(fromIso)) / 86_400_000));
  const dailyAverage = totalCost / days;
  return {
    tenantId, totalCost, dailyAverage, projectedMonthly: dailyAverage * 30, totalRequests: logs.length,
    costByModel: Object.entries(group(logs, (l) => l.modelId)).map(([modelId, d]) => ({ modelId, ...d })),
    costByApp: Object.entries(group(logs, (l) => l.appId)).map(([appId, d]) => ({ appId, ...d })).sort((a, b) => b.cost - a.cost),
    costByUser: Object.entries(group(logs, (l) => l.userId)).map(([userId, d]) => ({ userId, ...d })).sort((a, b) => b.cost - a.cost),
  };
}

export function costBreakdown(tenantId: string, logs: AuditLog[]) {
  const daily: Record<string, number> = {};
  for (const l of logs) {
    const date = (l.timestamp || '').slice(0, 10);
    if (date) daily[date] = (daily[date] || 0) + (l.estimatedCost || 0);
  }
  return { tenantId, breakdown: Object.entries(daily).map(([date, cost]) => ({ date, cost })).sort((a, b) => a.date.localeCompare(b.date)) };
}

export function costUsers(tenantId: string, logs: AuditLog[]) {
  const users: Record<string, { cost: number; requests: number; inputTokens: number; outputTokens: number }> = {};
  for (const l of logs) {
    const u = l.userId || 'unknown';
    users[u] ??= { cost: 0, requests: 0, inputTokens: 0, outputTokens: 0 };
    users[u].cost += l.estimatedCost || 0;
    users[u].requests += 1;
    users[u].inputTokens += l.inputTokens || 0;
    users[u].outputTokens += l.outputTokens || 0;
  }
  return { tenantId, users: Object.entries(users).map(([userId, d]) => ({ userId, ...d })).sort((a, b) => b.cost - a.cost) };
}

/** What each rule did, and the secrets and personal-data checks, for the Rules page. */
export function ruleActivity(logs: AuditLog[]) {
  const rules: Record<string, { stopped: number; flagged: number }> = {};
  const bump = (id: string, k: 'stopped' | 'flagged') => { rules[id] ??= { stopped: 0, flagged: 0 }; rules[id][k]++; };
  for (const l of logs) {
    const fired = l.triggeredRules ?? [];
    const stopper = l.eventType === 'request_blocked' ? fired[fired.length - 1] : undefined;
    if (stopper) bump(stopper, 'stopped');
    for (const r of fired) if (r !== stopper) bump(r, 'flagged');
  }
  return {
    rules,
    secrets: {
      stopped: logs.filter((l) => l.eventType === 'request_blocked' && l.metadata?.check === 'secrets').length,
      redacted: logs.filter((l) => l.eventType !== 'request_blocked' && l.metadata?.secretsRedacted).length,
    },
    // Personal data removed from prompts (check 3 on the Rules page); MCP results cleaned for agents aren't prompts.
    cleaned: logs.filter((l) => l.eventType !== 'request_blocked' && l.piiDetected && !isMcpCall(l)).length,
  };
}

/** Tool calls per MCP server, leaving out dashboard tests. */
export function mcpActivity(logs: AuditLog[]) {
  const servers: Record<string, { calls: number; stopped: number }> = {};
  for (const l of logs) {
    if (l.metadata?.kind !== 'mcp_tool_call' || l.metadata.test === 'true' || !l.metadata.mcpServer) continue;
    const s = (servers[l.metadata.mcpServer] ??= { calls: 0, stopped: 0 });
    s.calls++;
    if (l.eventType === 'request_blocked') s.stopped++;
  }
  return { servers };
}
