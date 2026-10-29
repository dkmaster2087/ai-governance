import Fastify from 'fastify';

const engine = { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn(), compliance: jest.fn() };
jest.mock('../clients/policy-admin.client', () => ({ PolicyAdminClient: jest.fn(() => engine) }));

async function appAs(role: 'tenant_admin' | 'tenant_auditor') {
  const { policiesRoutes } = await import('../routes/policies.routes');
  const app = Fastify();
  app.decorateRequest('principal', null);
  app.addHook('preHandler', async (req: any) => {
    req.principal = { kind: 'user', homeTenantId: 'tenant_acme', userId: 'u1', role };
    req.tenantId = 'tenant_acme';
    req.userId = 'u1';
  });
  await app.register(policiesRoutes, { prefix: '/v1' });
  return app;
}

const policy = { policyId: 'p1', tenantId: 'tenant_acme', name: 'Default', description: '', enabled: true, rules: [], createdAt: '', updatedAt: '', createdBy: 'x', sourceFramework: 'soc2' };

describe('policy and compliance routes', () => {
  beforeEach(() => { jest.clearAllMocks(); engine.list.mockResolvedValue([policy]); engine.compliance.mockResolvedValue({ ok: true }); });

  it('lists the caller’s own policies', async () => {
    const res = await (await appAs('tenant_auditor')).inject({ method: 'GET', url: '/v1/policies' });
    expect(res.statusCode).toBe(200);
    expect(engine.list).toHaveBeenCalledWith('tenant_acme');
  });

  it('refuses another tenant’s policies and compliance status', async () => {
    const app = await appAs('tenant_admin');
    expect((await app.inject({ method: 'GET', url: '/v1/policies/tenant_other' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/v1/compliance/status/tenant_other' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/v1/compliance/enable/tenant_other/soc2' })).statusCode).toBe(403);
    expect(engine.compliance).not.toHaveBeenCalled();
  });

  it('only lets admins change policies or packs', async () => {
    const app = await appAs('tenant_auditor');
    expect((await app.inject({ method: 'POST', url: '/v1/policies', payload: { name: 'x', rules: [] } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/v1/compliance/enable/tenant_acme/soc2' })).statusCode).toBe(403);
  });

  it('keeps a policy’s framework link when it is edited', async () => {
    const res = await (await appAs('tenant_admin')).inject({ method: 'PUT', url: '/v1/policies/p1', payload: { enabled: false, sourceFramework: 'hipaa' } });
    expect(res.statusCode).toBe(200);
    expect(engine.update).toHaveBeenCalledWith('tenant_acme', expect.objectContaining({ enabled: false, sourceFramework: 'soc2' }));
  });

  it('returns 404 for a policy outside the tenant', async () => {
    const res = await (await appAs('tenant_admin')).inject({ method: 'DELETE', url: '/v1/policies/someone-elses' });
    expect(res.statusCode).toBe(404);
    expect(engine.remove).not.toHaveBeenCalled();
  });

  it('enables a pack for the caller, recording who did it', async () => {
    await (await appAs('tenant_admin')).inject({ method: 'POST', url: '/v1/compliance/enable/tenant_acme/hipaa' });
    expect(engine.compliance).toHaveBeenCalledWith('post', '/enable/tenant_acme/hipaa', { enabledBy: 'u1' });
  });

  it('rejects odd framework names', async () => {
    const res = await (await appAs('tenant_admin')).inject({ method: 'POST', url: '/v1/compliance/enable/tenant_acme/..%2Fpolicies' });
    expect(res.statusCode).toBe(404);
  });
});
