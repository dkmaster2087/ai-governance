import Fastify from 'fastify';
import { AuditLog, Policy } from '@ai-governance/types';
import { applyRuleChange, buildRuleViews, newRule, ruleEffect, valuesOf } from '../services/rules';

const policy = (over: Partial<Policy> = {}): Policy => ({
  policyId: 'p1', tenantId: 'tenant_acme', name: 'Default', description: '', enabled: true, createdAt: '', updatedAt: '', createdBy: 'x',
  rules: [
    { ruleId: 'r_kw', type: 'keyword_block', action: 'block', priority: 1, enabled: true, description: 'Stop secrets', config: { keywords: ['confidential'] } },
    { ruleId: 'r_flag', type: 'pii_detection', action: 'mask', priority: 2, enabled: true, description: 'Flag PII', config: {} },
    { ruleId: 'r_audit', type: 'audit_logging', action: 'allow', priority: 3, enabled: true, description: 'Log all', config: {} },
  ],
  ...over,
});

const log = (over: Partial<AuditLog>): AuditLog => ({
  logId: 'l', requestId: 'r', tenantId: 't', userId: 'u', appId: 'a', eventType: 'request_allowed', provider: 'openai', modelId: 'm',
  promptHash: '', responseHash: '', policyDecision: 'allow', triggeredRules: [], piiDetected: false, piiTypes: [], inputTokens: 0,
  outputTokens: 0, estimatedCost: 0, latencyMs: 0, timestamp: '', metadata: {}, ...over,
});

describe('rules', () => {
  it('classifies what each rule really does', () => {
    expect(ruleEffect({ type: 'keyword_block', action: 'block' })).toBe('stops');
    expect(ruleEffect({ type: 'pii_detection', action: 'mask' })).toBe('flags');
    expect(ruleEffect({ type: 'audit_logging', action: 'allow' })).toBe('not_enforced');
  });

  it('counts stops for the stopping rule and flags for the rest', () => {
    const views = buildRuleViews([policy()], [
      log({ eventType: 'request_blocked', triggeredRules: ['r_flag', 'r_kw'] }),
      log({ triggeredRules: ['r_flag'] }),
    ]);
    const kw = views.find((v) => v.ruleId === 'r_kw')!;
    const flag = views.find((v) => v.ruleId === 'r_flag')!;
    expect([kw.stopped, kw.flagged]).toEqual([1, 0]);
    expect([flag.stopped, flag.flagged]).toEqual([0, 2]);
  });

  it('treats a rule in a switched-off policy as off', () => {
    const views = buildRuleViews([policy({ enabled: false })], []);
    expect(views.every((v) => !v.enabled)).toBe(true);
  });

  it('edits values and switching a rule on re-enables its policy', () => {
    const changed = applyRuleChange(policy({ enabled: false }), 'r_kw', { values: ['secret', 'internal only'], enabled: true })!;
    expect(valuesOf(changed.rules[0])).toEqual(['secret', 'internal only']);
    expect(changed.enabled).toBe(true);
    expect(applyRuleChange(policy(), 'missing', { enabled: false })).toBeNull();
    expect(applyRuleChange(policy(), 'r_audit', { values: ['x'] })).toBeNull();
  });

  it('creates blocking rules after the existing ones', () => {
    const r = newRule({ type: 'model_restriction', description: 'Approved models', values: ['gpt-4o'] }, policy().rules);
    expect(r).toMatchObject({ type: 'model_restriction', action: 'block', priority: 4, enabled: true, config: { allowedModels: ['gpt-4o'] } });
  });
});

// ── Routes ─────────────────────────────────────────────────────────────────
const engine = { list: jest.fn(), create: jest.fn(), update: jest.fn() };
jest.mock('../clients/policy-admin.client', () => ({ PolicyAdminClient: jest.fn(() => engine) }));
jest.mock('../services/audit-query', () => ({ queryAuditLogs: jest.fn(async () => ({ logs: [], truncated: false })) }));
jest.mock('../services/tenant-settings.service', () => ({ tenantSettings: () => ({ getFailMode: async () => 'closed', invalidate: () => {} }) }));

async function appAs(role: 'tenant_admin' | 'tenant_auditor') {
  const { rulesRoutes } = await import('../routes/rules.routes');
  const app = Fastify();
  app.decorateRequest('principal', null);
  app.addHook('preHandler', async (req: any) => {
    req.principal = { kind: 'user', homeTenantId: 'tenant_acme', userId: 'u1', role };
    req.tenantId = 'tenant_acme';
    req.userId = 'u1';
  });
  await app.register(rulesRoutes, { prefix: '/v1' });
  return app;
}

describe('rules routes', () => {
  beforeEach(() => { jest.clearAllMocks(); engine.list.mockResolvedValue([policy()]); });

  it('lists rules with the fail mode', async () => {
    const app = await appAs('tenant_auditor');
    const res = await app.inject({ method: 'GET', url: '/v1/rules' });
    expect(res.statusCode).toBe(200);
    expect(res.json().failMode).toBe('closed');
    expect(res.json().rules).toHaveLength(3);
    expect(engine.list).toHaveBeenCalledWith('tenant_acme');
  });

  it('only lets admins change rules', async () => {
    const app = await appAs('tenant_auditor');
    expect((await app.inject({ method: 'PATCH', url: '/v1/rules/p1/r_kw', payload: { enabled: false } })).statusCode).toBe(403);
  });

  it('cannot reach a policy outside the caller’s tenant', async () => {
    const app = await appAs('tenant_admin');
    const res = await app.inject({ method: 'PATCH', url: '/v1/rules/other-tenant-policy/r_kw', payload: { enabled: false } });
    expect(res.statusCode).toBe(404);
    expect(engine.update).not.toHaveBeenCalled();
  });

  it('turns a rule off and saves under the caller’s tenant', async () => {
    const app = await appAs('tenant_admin');
    const res = await app.inject({ method: 'PATCH', url: '/v1/rules/p1/r_kw', payload: { enabled: false } });
    expect(res.statusCode).toBe(200);
    expect(engine.update).toHaveBeenCalledWith('tenant_acme', expect.objectContaining({ policyId: 'p1' }));
    expect(engine.update.mock.calls[0][1].rules[0].enabled).toBe(false);
  });

  it('adds a rule to a new Custom rules policy', async () => {
    const app = await appAs('tenant_admin');
    const res = await app.inject({ method: 'POST', url: '/v1/rules', payload: { type: 'keyword_block', description: 'Stop codenames', values: ['phoenix'] } });
    expect(res.statusCode).toBe(201);
    expect(engine.create).toHaveBeenCalledWith('tenant_acme', expect.objectContaining({ name: 'Custom rules' }));
  });

  it('rejects unknown personal-data types', async () => {
    const app = await appAs('tenant_admin');
    const res = await app.inject({ method: 'POST', url: '/v1/rules', payload: { type: 'pii_detection', description: 'x', values: ['PASSPORT'] } });
    expect(res.statusCode).toBe(400);
  });

  it('won’t delete a rule that belongs to a compliance framework', async () => {
    engine.list.mockResolvedValue([policy({ sourceFramework: 'soc2' })]);
    const app = await appAs('tenant_admin');
    const res = await app.inject({ method: 'DELETE', url: '/v1/rules/p1/r_kw' });
    expect(res.statusCode).toBe(409);
  });
});
