import http from 'http';
import { AddressInfo } from 'net';
import Fastify, { FastifyInstance } from 'fastify';
import { INTERNAL_HEADER, newInternalKey, signingKeyFrom, trustedKeysFrom, verifyInternal } from '@ai-governance/utils';
import { AnalyticsClient, setAnalyticsClient } from '../clients/analytics.client';

const PAIR = newInternalKey('gateway');
const KEY = () => signingKeyFrom(PAIR.signing);
const TRUST = trustedKeysFrom([PAIR.trusted]);

describe('reports go to the analytics service', () => {
  let analytics: http.Server;
  let url: string;
  const seen: Array<{ path: string; caller: ReturnType<typeof verifyInternal> }> = [];
  let answer: { status: number; body: unknown } = { status: 200, body: { ok: true } };

  // The routes under test, loaded once (slow when every suite runs at once).
  const routes: any[] = [];
  beforeAll(async () => {
    for (const m of ['gateway', 'cost', 'evidence', 'platform', 'shadow-ai'] as const) routes.push(Object.values(await import(`../routes/${m}.routes`))[0]);
  }, 60_000);

  beforeAll(async () => {
    analytics = http.createServer((req, res) => {
      try {
        seen.push({ path: req.url!, caller: verifyInternal(String(req.headers[INTERNAL_HEADER]), TRUST, 'analytics') });
      } catch {
        res.writeHead(401); return res.end('{}');
      }
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer.body));
    });
    await new Promise<void>((r) => analytics.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(analytics.address() as AddressInfo).port}`;
  });
  afterAll(async () => { setAnalyticsClient(null); analytics.closeAllConnections(); await new Promise((r) => analytics.close(r)); });
  beforeEach(() => { seen.length = 0; answer = { status: 200, body: { ok: true } }; setAnalyticsClient(new AnalyticsClient(url, KEY)); });

  async function appAs(principal: object, tenantId = 'tenant_acme'): Promise<FastifyInstance> {
    const app = Fastify();
    app.decorateRequest('principal', null);
    app.addHook('preHandler', async (req: any) => { req.principal = principal; req.tenantId = tenantId; req.userId = (principal as any).userId; });
    for (const fn of routes) await app.register(fn, { prefix: '/v1' });
    return app;
  }
  const admin = { kind: 'user', homeTenantId: 'tenant_acme', userId: 'u1', email: 'a@acme.example', role: 'tenant_admin' };

  it('forwards with a signed token for the signed-in user\'s company, keeping the query', async () => {
    const app = await appAs(admin);
    const r = await app.inject({ method: 'GET', url: '/v1/gateway/summary?from=2026-11-01T00:00:00Z&tz=-60' });
    expect(r.json()).toEqual({ ok: true });
    expect(seen[0]).toEqual({ path: '/internal/v1/gateway/summary?from=2026-11-01T00:00:00Z&tz=-60', caller: { tenantId: 'tenant_acme', userId: 'u1', role: 'tenant_admin', email: 'a@acme.example' } });
    await app.inject({ method: 'GET', url: '/v1/shadow-ai/summary' });
    await app.inject({ method: 'GET', url: '/v1/evidence?outcome=stopped' });
    expect(seen.map((s) => s.path)).toEqual(['/internal/v1/gateway/summary?from=2026-11-01T00:00:00Z&tz=-60', '/internal/v1/shadow-ai/summary', '/internal/v1/evidence?outcome=stopped']);
  });

  it('sends the company checked in the address for spend, and refuses other companies before analytics is asked', async () => {
    const platform = await appAs({ kind: 'user', homeTenantId: 'tenant_platform', userId: 'p1', role: 'platform_admin' }, 'tenant_platform');
    await platform.inject({ method: 'GET', url: '/v1/cost/summary/tenant_acme?period=7d' });
    expect(seen[0]).toMatchObject({ path: '/internal/v1/cost/summary?period=7d', caller: { tenantId: 'tenant_acme', role: 'platform_admin' } });
    const other = await (await appAs(admin)).inject({ method: 'GET', url: '/v1/cost/summary/tenant_other' });
    expect(other.statusCode).toBe(403);
    expect(seen).toHaveLength(1);
  });

  it('passes analytics answers back, builds the evidence download, and says reports are unavailable when analytics is down', async () => {
    const app = await appAs(admin);
    answer = { status: 404, body: { error: 'No record for that request', code: 'NOT_FOUND' } };
    expect((await app.inject({ method: 'GET', url: '/v1/evidence/x' })).statusCode).toBe(404);
    answer = { status: 200, body: { requestId: 'req-1', outcome: 'stopped' } };
    const file = await app.inject({ method: 'GET', url: '/v1/evidence/req-1/export' });
    expect(file.headers['content-disposition']).toBe('attachment; filename="probaline-evidence-req-1.json"');
    expect(JSON.parse(file.body)).toMatchObject({ exportedBy: 'u1', tenantId: 'tenant_acme', record: { requestId: 'req-1' } });

    answer = { status: 500, body: {} };
    expect((await app.inject({ method: 'GET', url: '/v1/gateway/stopped' })).json()).toMatchObject({ code: 'ANALYTICS_UNAVAILABLE' });
    setAnalyticsClient(new AnalyticsClient('http://127.0.0.1:9', KEY, 1000));
    const down = await app.inject({ method: 'GET', url: '/v1/gateway/summary' });
    expect(down.statusCode).toBe(503);
    expect(down.json().error).toMatch(/AI traffic is not affected/);
    setAnalyticsClient(new AnalyticsClient(url, () => signingKeyFrom({ iss: 'gateway', privateKey: 'not a key' })));
    expect((await app.inject({ method: 'GET', url: '/v1/gateway/summary' })).statusCode).toBe(503); // not configured
  });
});
