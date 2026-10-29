import Fastify from 'fastify';

const send = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/lib-dynamodb'),
  DynamoDBDocumentClient: { from: () => ({ send }) },
}));
const keys = { getForTenant: jest.fn(), create: jest.fn(), revoke: jest.fn(), setLicenseInfo: jest.fn() };
jest.mock('../repositories/api-key.repository', () => ({
  ...jest.requireActual('../repositories/api-key.repository'),
  ApiKeyRepository: jest.fn(() => keys),
}));

async function appAs(role: string, home = 'tenant_acme') {
  const { tenantRoutes } = await import('../routes/tenant.routes');
  const app = Fastify();
  app.decorateRequest('principal', null);
  app.addHook('preHandler', async (req: any) => {
    req.principal = { kind: 'user', homeTenantId: home, userId: 'u1', role };
    req.tenantId = home;
    req.userId = 'u1';
  });
  await app.register(tenantRoutes, { prefix: '/v1' });
  return app;
}

const license = (over: object = {}) => ({
  tenantId: 'tenant_acme', keyId: 'lic1', keyHash: 'secret-hash', keyPrefix: 'aegis_acme_ab...', name: 'License',
  scopes: ['reporting:ingest'], status: 'active', rateLimit: 60, createdAt: '2026-10-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z',
  createdBy: 'p', license: { plan: 'enterprise', type: 'onprem', maxUsers: 200, reportingConfig: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: false } },
  ...over,
});

describe('licenses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    keys.getForTenant.mockResolvedValue([license(), { ...license({ keyId: 'app', scopes: ['chat'] }) }]);
    send.mockResolvedValue({ Item: { tenantId: 'tenant_acme', name: 'Acme' }, Items: [{ tenantId: 'tenant_acme', name: 'Acme' }] });
  });

  it('shows a tenant its own license without the key hash', async () => {
    const res = await (await appAs('tenant_auditor')).inject({ method: 'GET', url: '/v1/license' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ licenseId: 'lic1', tenantName: 'Acme', plan: 'enterprise', status: 'active', maxUsers: 200 });
    expect(res.body).not.toContain('secret-hash');
  });

  it('only lets platform admins see every license or issue one', async () => {
    const tenantAdmin = await appAs('tenant_admin');
    expect((await tenantAdmin.inject({ method: 'GET', url: '/v1/licenses' })).statusCode).toBe(403);
    expect((await tenantAdmin.inject({ method: 'POST', url: '/v1/tenants/tenant_acme/licenses', payload: {} })).statusCode).toBe(403);
    const platform = await appAs('platform_admin', 'tenant_platform');
    const all = await platform.inject({ method: 'GET', url: '/v1/licenses' });
    expect(all.json().map((l: any) => l.licenseId)).toEqual(['lic1']);
  });

  it('returns the raw key once when issuing, with plan details', async () => {
    const res = await (await appAs('platform_admin', 'tenant_platform')).inject({
      method: 'POST', url: '/v1/tenants/tenant_acme/licenses', payload: { plan: 'starter', type: 'cloud', maxUsers: 10, validityDays: 30 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().licenseKey).toMatch(/^aegis_acme_/);
    expect(keys.create.mock.calls[0][0]).toMatchObject({ scopes: ['reporting:ingest'], license: { plan: 'starter', type: 'cloud', maxUsers: 10 } });
  });

  it('lets tenant admins, not auditors, change what is reported', async () => {
    const body = { usageMetrics: true, costData: false, complianceStatus: true, auditLogs: false };
    expect((await (await appAs('tenant_auditor')).inject({ method: 'PUT', url: '/v1/license/reporting', payload: body })).statusCode).toBe(403);
    const res = await (await appAs('tenant_admin')).inject({ method: 'PUT', url: '/v1/license/reporting', payload: body });
    expect(res.statusCode).toBe(200);
    expect(keys.setLicenseInfo).toHaveBeenCalledWith('tenant_acme', 'lic1', expect.objectContaining({ reportingConfig: body }));
  });
});
