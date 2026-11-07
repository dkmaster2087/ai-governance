import Fastify from 'fastify';
import { collection, MemoryStore, setRecords } from '@ai-governance/storage';
import { hashApiKey } from '../repositories/api-key.repository';

const RAW = 'pbl_acme_onprem_license';

describe('on-prem reports', () => {
  beforeEach(async () => {
    setRecords(new MemoryStore());
    await collection('apiKeys').put({
      tenantId: 'tenant_acme', keyId: 'lic1', keyHash: hashApiKey(RAW), keyPrefix: 'pbl_acme', name: 'License',
      scopes: ['reporting:ingest'], status: 'active', rateLimit: 60, createdAt: new Date().toISOString(), createdBy: 'p',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      license: { plan: 'enterprise', type: 'onprem', maxUsers: 10, reportingConfig: { usageMetrics: true, costData: false, complianceStatus: true, auditLogs: false } },
    });
  });

  async function app(role = 'tenant_admin', tenantId = 'tenant_acme') {
    const { reportingRoutes } = await import('../routes/reporting.routes');
    const a = Fastify();
    a.decorateRequest('principal', null);
    a.addHook('preHandler', async (req: any) => {
      req.principal = { kind: 'user', homeTenantId: tenantId, userId: 'u1', role };
      req.tenantId = tenantId; req.userId = 'u1';
    });
    await a.register(reportingRoutes, { prefix: '/v1' });
    return a;
  }
  const send = (a: any, body: object) => a.inject({ method: 'POST', url: '/v1/reporting/ingest', payload: body });

  it('keeps a report, only the parts the company allows, and shows when it last reported', async () => {
    const a = await app();
    expect((await a.inject({ method: 'GET', url: '/v1/reporting/status/tenant_acme' })).json()).toMatchObject({ status: 'awaiting_first_report', lastReportAt: null });
    const res = await send(a, {
      licenseKey: RAW, tenantId: 'tenant_acme', agentVersion: '1.0.0',
      data: { usageMetrics: { totalRequests: 7 }, costData: { totalCost: 9 }, complianceStatus: { enabledFrameworks: ['hipaa'] }, auditLogs: [{ prompt: 'x' }] },
    });
    expect(res.json()).toMatchObject({ accepted: true, reportId: expect.stringMatching(/^rpt_/) });
    const status = (await a.inject({ method: 'GET', url: '/v1/reporting/status/tenant_acme' })).json();
    expect(status).toMatchObject({ status: 'reporting', agentVersion: '1.0.0', lastReport: { usageMetrics: { totalRequests: 7 }, complianceStatus: { enabledFrameworks: ['hipaa'] } } });
    expect(status.lastReport.costData).toBeUndefined();
    expect(status.lastReport.auditLogs).toBeUndefined();
  });

  it('refuses reports with a wrong key or for another company', async () => {
    const a = await app();
    expect((await send(a, { licenseKey: 'nope', tenantId: 'tenant_acme', data: {} })).statusCode).toBe(403);
    expect((await send(a, { licenseKey: RAW, tenantId: 'tenant_other', data: {} })).statusCode).toBe(403);
    expect((await (await app('tenant_admin', 'tenant_other')).inject({ method: 'GET', url: '/v1/reporting/status/tenant_acme' })).statusCode).toBe(403);
  });
});
