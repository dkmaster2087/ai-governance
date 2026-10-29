import Fastify from 'fastify';

const send = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/lib-dynamodb'),
  DynamoDBDocumentClient: { from: () => ({ send }) },
}));

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
  beforeEach(() => { jest.clearAllMocks(); send.mockResolvedValue({}); });

  it('creates a tenant that fails closed by default', async () => {
    const res = await (await platformApp()).inject({ method: 'POST', url: '/v1/tenants', payload: { name: 'Acme', adminEmail: 'it@acme.com' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Acme', plan: 'starter', status: 'active', settings: { governanceFailMode: 'closed', auditLogRetentionDays: 365 } });
  });

  it('refuses a tenant without a valid admin email', async () => {
    const res = await (await platformApp()).inject({ method: 'POST', url: '/v1/tenants', payload: { name: 'Acme', adminEmail: 'nope' } });
    expect(res.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('changes only the fields sent, never replacing settings wholesale', async () => {
    const res = await (await platformApp()).inject({ method: 'PUT', url: '/v1/tenants/tenant_acme', payload: { plan: 'enterprise', auditLogRetentionDays: 730 } });
    expect(res.statusCode).toBe(200);
    const update = send.mock.calls.map((c) => c[0].input).find((i) => i.UpdateExpression?.includes('#plan'));
    expect(update.UpdateExpression).toContain('settings.auditLogRetentionDays = :retention');
    expect(update.UpdateExpression).not.toMatch(/settings = :settings/);
    expect(update.ExpressionAttributeValues).toMatchObject({ ':plan': 'enterprise', ':retention': 730 });
  });

  it('says when the tenant does not exist', async () => {
    send.mockImplementation(async (cmd: any) => {
      if (cmd.input.ConditionExpression) throw Object.assign(new Error('nope'), { name: 'ConditionalCheckFailedException' });
      return {};
    });
    const res = await (await platformApp()).inject({ method: 'PUT', url: '/v1/tenants/missing', payload: { name: 'X' } });
    expect(res.statusCode).toBe(404);
  });
});
