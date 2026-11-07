import { FastifyInstance } from 'fastify';
import { collection, MemoryStore, setRecords } from '@ai-governance/storage';
import { AuditLog } from '@ai-governance/types';
import { INTERNAL_HEADER, signInternal } from '@ai-governance/utils';
import { buildApp } from '../app';

const KEY = 'test-internal-key-'.padEnd(40, 'x');
const now = Date.now();
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

function log(tenantId: string, over: Partial<AuditLog> = {}): AuditLog & Record<string, unknown> {
  return {
    logId: `l-${Math.random()}`, requestId: `req-${Math.random().toString(36).slice(2)}`, tenantId, userId: 'jane', appId: 'support-bot',
    eventType: 'request_allowed', provider: 'openai', modelId: 'gpt-4o-mini', promptHash: 'h', responseHash: 'r', policyDecision: 'allow',
    triggeredRules: [], piiDetected: false, piiTypes: [], inputTokens: 10, outputTokens: 20, estimatedCost: 0.5, latencyMs: 100,
    timestamp: at(30), metadata: {}, ...over,
  } as AuditLog & Record<string, unknown>;
}

describe('analytics', () => {
  let app: FastifyInstance;
  const as = (tenantId: string, role = 'tenant_admin') => ({ [INTERNAL_HEADER]: signInternal({ tenantId, userId: 'u1', role }, KEY, 'analytics') });
  const get = (url: string, headers: Record<string, string> = as('tenant_a')) => app.inject({ method: 'GET', url, headers });

  beforeEach(async () => {
    setRecords(new MemoryStore());
    app = await buildApp({ key: KEY });
    const audit = collection('auditLogs');
    await collection('tenants').put({ tenantId: 'tenant_a', settings: { auditLogRetentionDays: 90 } });
    await collection('tenants').put({ tenantId: 'tenant_b' });
    await audit.put(log('tenant_a', { requestId: 'a-1', estimatedCost: 1 }));
    await audit.put(log('tenant_a', { requestId: 'a-2', eventType: 'request_blocked', triggeredRules: ['r_kw'], estimatedCost: 0 }));
    await audit.put(log('tenant_a', { requestId: 'a-3', piiDetected: true, triggeredRules: ['r_pii'] }));
    await audit.put(log('tenant_a', { requestId: 'a-mcp', metadata: { kind: 'mcp_tool_call', mcpServer: 'hr' } }));
    await audit.put(log('tenant_b', { requestId: 'b-1', estimatedCost: 99 }));
  });
  afterEach(() => app.close());

  it('answers only the gateway, with a valid token for a role that may read reports', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await get('/internal/v1/gateway/summary', {})).statusCode).toBe(401);
    expect((await get('/internal/v1/gateway/summary', { [INTERNAL_HEADER]: signInternal({ tenantId: 'tenant_a', userId: 'u', role: 'tenant_admin' }, 'other-key'.padEnd(40, 'y'), 'analytics') })).statusCode).toBe(401);
    expect((await get('/internal/v1/gateway/summary', { [INTERNAL_HEADER]: signInternal({ tenantId: 'tenant_a', userId: 'u', role: 'tenant_admin' }, KEY, 'policy-engine') })).statusCode).toBe(401);
    expect((await get('/internal/v1/gateway/summary', as('tenant_a', 'tenant_user'))).statusCode).toBe(403);
    expect((await get('/internal/v1/gateway/summary')).statusCode).toBe(200);
  });

  it('keeps companies apart: the company comes from the token, never the address', async () => {
    const spend = (await get('/internal/v1/cost/summary?tenantId=tenant_b')).json();
    expect(spend).toMatchObject({ tenantId: 'tenant_a', totalCost: 1.5, totalRequests: 3 }); // MCP calls aren't model spend
    expect((await get('/internal/v1/evidence/b-1')).statusCode).toBe(404);
    expect((await get('/internal/v1/evidence/b-1', as('tenant_b'))).json()).toMatchObject({ requestId: 'b-1' });
  });

  it('builds the traffic, stopped, evidence, rule and MCP reports', async () => {
    expect((await get('/internal/v1/gateway/summary')).json()).toMatchObject({ delivered: 2, cleaned: 1, checks: { policy: { stopped: 1 } } });
    expect((await get('/internal/v1/gateway/stopped')).json().total).toBe(1);
    const list = (await get('/internal/v1/evidence?outcome=stopped')).json();
    expect(list.items.map((i: any) => i.requestId)).toEqual(['a-2']);
    expect((await get('/internal/v1/evidence/a-1')).json()).toMatchObject({ requestId: 'a-1', outcome: 'delivered' });
    expect((await get('/internal/v1/rules/activity')).json()).toMatchObject({ rules: { r_kw: { stopped: 1, flagged: 0 }, r_pii: { stopped: 0, flagged: 1 } }, cleaned: 1 });
    expect((await get('/internal/v1/mcp/activity')).json().servers).toEqual({ hr: { calls: 1, stopped: 0 } });
    expect((await get('/internal/v1/gateway/summary?from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z')).json().code).toBe('INVALID_RANGE');
  });

  it('shows the platform view to platform admins only', async () => {
    expect((await get('/internal/v1/platform/usage')).statusCode).toBe(403);
    const usage = (await get('/internal/v1/platform/usage?days=7', as('tenant_platform', 'platform_admin'))).json();
    expect(usage.tenants.map((t: any) => t.tenantId).sort()).toEqual(['tenant_a', 'tenant_b']);
  });

  it('gives the reporting agent its own summary and nothing else', async () => {
    const agent = as('tenant_a', 'reporting_agent');
    const summary = (await get('/internal/v1/reporting/summary', agent)).json();
    expect(summary.usage).toMatchObject({ totalRequests: 3, blockedRequests: 1, activeUsers: 1 });
    expect(summary.cost.totalCost).toBe(1.5);
    expect((await get('/internal/v1/evidence', agent)).statusCode).toBe(403);
    expect((await get('/internal/v1/reporting/summary', as('tenant_a', 'tenant_user'))).statusCode).toBe(403);
  });
});
