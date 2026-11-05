import Fastify from 'fastify';
import { collection, MemoryStore, setRecords } from '@ai-governance/storage';

async function platformApp() {
  const { tenantRoutes } = await import('../routes/tenant.routes');
  const { errorHandler } = await import('../middleware/error.handler');
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  app.decorateRequest('principal', null);
  app.addHook('preHandler', async (req: any) => {
    req.principal = { kind: 'user', homeTenantId: 'platform', userId: 'u1', role: 'platform_admin' };
    req.tenantId = 'platform';
    req.userId = 'u1';
  });
  await app.register(tenantRoutes, { prefix: '/v1' });
  return app;
}

describe('tenant onboarding and edits', () => {
  beforeEach(() => { setRecords(new MemoryStore()); });

  it('creates a tenant that fails closed by default', async () => {
    const res = await (await platformApp()).inject({ method: 'POST', url: '/v1/tenants', payload: { name: 'Acme', adminEmail: 'it@acme.com' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Acme', plan: 'starter', status: 'active', settings: { governanceFailMode: 'closed', auditLogRetentionDays: 365 } });
  });

  it('refuses a tenant without a valid admin email', async () => {
    const res = await (await platformApp()).inject({ method: 'POST', url: '/v1/tenants', payload: { name: 'Acme', adminEmail: 'nope' } });
    expect(res.statusCode).toBe(400);
    expect((await collection('tenants').scan()).items).toEqual([]);
  });

  it('changes only the fields sent, never replacing settings wholesale', async () => {
    await collection('tenants').put({
      tenantId: 'tenant_acme', name: 'Acme', plan: 'starter',
      settings: { governanceFailMode: 'open', auditLogRetentionDays: 365, shadowAiDecisions: 'kept' },
    });
    const res = await (await platformApp()).inject({ method: 'PUT', url: '/v1/tenants/tenant_acme', payload: { plan: 'enterprise', auditLogRetentionDays: 730 } });
    expect(res.statusCode).toBe(200);
    expect(await collection('tenants').get({ tenantId: 'tenant_acme' })).toMatchObject({
      name: 'Acme', plan: 'enterprise',
      // Other settings survive; only the retention changed.
      settings: { governanceFailMode: 'open', auditLogRetentionDays: 730, shadowAiDecisions: 'kept' },
    });
  });

  it('says when the tenant does not exist', async () => {
    const res = await (await platformApp()).inject({ method: 'PUT', url: '/v1/tenants/missing', payload: { name: 'X' } });
    expect(res.statusCode).toBe(404);
    // …and doesn't create it as a side effect.
    expect(await collection('tenants').get({ tenantId: 'missing' })).toBeNull();
  });
});
