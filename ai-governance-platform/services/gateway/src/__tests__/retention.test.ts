import Fastify from 'fastify';
import { collection, MemoryObjectStore, MemoryStore, objects, setObjects, setRecords } from '@ai-governance/storage';
import { dailySweep, expiryOf, sweepArchive } from '../services/retention';
import { tenantSettings } from '../services/tenant-settings.service';

const DAY = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const T = 'tenant_acme';
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('evidence retention', () => {
  let store: MemoryObjectStore;
  beforeEach(async () => {
    setRecords(new MemoryStore());
    store = new MemoryObjectStore();
    setObjects(store);
    await collection('tenants').put({ tenantId: T, name: 'Acme', createdAt: new Date(Date.now() - 40 * DAY).toISOString(), settings: { auditLogRetentionDays: 30 } });
    tenantSettings().invalidate(T);
  });
  afterAll(() => setObjects(null));

  async function appAs(role: string) {
    const { tenantRoutes } = await import('../routes/tenant.routes');
    const app = Fastify();
    app.decorateRequest('principal', null);
    app.addHook('preHandler', async (req: any) => {
      req.principal = { kind: 'user', homeTenantId: T, userId: 'u1', email: 'counsel@acme.example', role };
      req.tenantId = T; req.userId = 'u1';
    });
    await app.register(tenantRoutes, { prefix: '/v1' });
    return app;
  }

  it('dates each record from the company\'s period, and a hold keeps everything', async () => {
    const ts = new Date().toISOString();
    expect(expiryOf(ts, { days: 30, hold: false })).toBe(Math.floor((Date.parse(ts) + 30 * DAY) / 1000));
    expect(expiryOf(ts, { days: 30, hold: true })).toBeUndefined();
  });

  it('places a hold with a reason, which takes the expiry off existing records, and releasing puts it back', async () => {
    const old = new Date(Date.now() - 10 * DAY).toISOString();
    await collection('auditLogs').put({ tenantId: T, requestId: 'r1', timestamp: old, ttl: Math.floor(Date.now() / 1000) + 999_999 });
    const admin = await appAs('tenant_admin');
    expect((await admin.inject({ method: 'PUT', url: `/v1/tenants/${T}/legal-hold`, payload: { on: true } })).json().code).toBe('REASON_REQUIRED');
    const placed = await admin.inject({ method: 'PUT', url: `/v1/tenants/${T}/legal-hold`, payload: { on: true, reason: 'Smith v Acme' } });
    expect(placed.json().legalHold).toMatchObject({ on: true, by: 'counsel@acme.example', reason: 'Smith v Acme' });
    await settle();
    expect((await collection('auditLogs').get({ tenantId: T, requestId: 'r1' }))?.ttl).toBeUndefined();

    await admin.inject({ method: 'PUT', url: `/v1/tenants/${T}/legal-hold`, payload: { on: false } });
    await settle();
    expect((await collection('auditLogs').get({ tenantId: T, requestId: 'r1' }))?.ttl).toBe(Math.floor((Date.parse(old) + 30 * DAY) / 1000));
    expect((await (await appAs('tenant_auditor')).inject({ method: 'PUT', url: `/v1/tenants/${T}/legal-hold`, payload: { on: false } })).statusCode).toBe(403);
  });

  it('removes archive days past the period, once a day across instances, and never while on hold', async () => {
    const now = Date.now();
    const put = (daysAgo: number) => objects('b').put(`logs/${T}/${day(now - daysAgo * DAY)}/x.json`, '{}');
    await Promise.all([put(35), put(31), put(29), put(1)]);
    await collection('tenants').update({ tenantId: T }, { set: { 'settings.legalHold': { on: true } } });
    tenantSettings().invalidate(T);
    expect(await sweepArchive((await collection('tenants').get({ tenantId: T })) as any, now)).toBe(0);

    await collection('tenants').update({ tenantId: T }, { set: { 'settings.legalHold': { on: false } } });
    tenantSettings().invalidate(T);
    expect(await dailySweep(now)).toBe(true);
    expect(await dailySweep(now)).toBe(false); // another instance, same day
    expect((await store.list(`logs/${T}/`)).length).toBe(2);
    expect((await collection('tenants').get({ tenantId: T }))?.archiveSweptThrough).toBe(day(now - 31 * DAY));
  });
});
