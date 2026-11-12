import Fastify from 'fastify';
import { collection, MemoryStore, setRecords } from '@ai-governance/storage';
import { computeLicenseStatus, LicenseKey, LicenseStateService, setLicenseState } from '../services/license-state';
import { createAuthPlugin } from '../middleware/auth.middleware';
import { hashApiKey } from '../repositories/api-key.repository';
import { setAnalyticsClient } from '../clients/analytics.client';

const DAY = 86_400_000;
const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * DAY).toISOString();

const lic = (over: Partial<LicenseKey> = {}): LicenseKey => ({
  tenantId: 'tenant_acme', keyId: 'lic1', keyHash: 'secret-hash', keyPrefix: 'pbl_acme_ab...', name: 'License',
  scopes: ['reporting:ingest'], status: 'active', rateLimit: 60, createdAt: iso(-100), expiresAt: iso(265),
  createdBy: 'p', license: { plan: 'enterprise', type: 'onprem', maxUsers: 200, reportingConfig: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: false } },
  ...over,
} as LicenseKey);

describe('license state', () => {
  const since = iso(-1);
  it('is active, then expiring in the last 30 days', () => {
    expect(computeLicenseStatus([lic()], since)).toMatchObject({ state: 'active', plan: 'enterprise' });
    expect(computeLicenseStatus([lic({ expiresAt: iso(10) })], since)).toMatchObject({ state: 'expiring', daysLeft: 10 });
  });
  it('gives 30 days of grace after a license expires, then lapses', () => {
    expect(computeLicenseStatus([lic({ expiresAt: iso(-5) })], since)).toMatchObject({ state: 'grace', reason: 'expired', daysLeft: 25 });
    expect(computeLicenseStatus([lic({ expiresAt: iso(-31) })], since)).toMatchObject({ state: 'lapsed', reason: 'expired' });
  });
  it('uses the grace chosen at revocation, and counts removal as an end', () => {
    expect(computeLicenseStatus([lic({ status: 'revoked', revokedAt: iso(0), graceUntil: iso(30) })], since)).toMatchObject({ state: 'grace', reason: 'revoked', daysLeft: 30 });
    expect(computeLicenseStatus([lic({ status: 'revoked', revokedAt: iso(0), graceUntil: iso(0) })], since)).toMatchObject({ state: 'lapsed', reason: 'revoked' });
    expect(computeLicenseStatus([lic({ activation: 'removed', removedAt: iso(-2) })], since)).toMatchObject({ state: 'grace', reason: 'removed', daysLeft: 28 });
  });
  it('ignores issued keys nobody entered yet, and counts a company without a license from when it had none', () => {
    expect(computeLicenseStatus([lic({ activation: 'pending' })], iso(-10))).toMatchObject({ state: 'grace', reason: 'none', daysLeft: 20 });
    expect(computeLicenseStatus([], iso(-40))).toMatchObject({ state: 'lapsed', reason: 'none' });
  });
  it('lets any valid license win over ended ones', () => {
    expect(computeLicenseStatus([lic({ keyId: 'old', status: 'revoked', revokedAt: iso(-60), graceUntil: iso(-30) }), lic({ keyId: 'new' })], since).state).toBe('active');
  });
});

describe('licenses', () => {
  beforeEach(async () => {
    setRecords(new MemoryStore());
    setLicenseState(new LicenseStateService(0));
    await collection('tenants').put({ tenantId: 'tenant_acme', name: 'Acme', createdAt: iso(-400) });
    await collection('tenants').put({ tenantId: 'tenant_other', name: 'Other', createdAt: iso(-400) });
  });
  afterAll(() => setLicenseState(null));

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
  const platform = () => appAs('platform_admin', 'tenant_platform');
  const issue = async (tenantId = 'tenant_acme', over: object = {}) =>
    (await (await platform()).inject({ method: 'POST', url: `/v1/tenants/${tenantId}/licenses`, payload: { plan: 'starter', type: 'cloud', validityDays: 365, ...over } })).json();

  it('issues a key that counts only once the company enters it', async () => {
    const issued = await issue();
    expect(issued).toMatchObject({ status: 'pending', licenseKey: expect.stringMatching(/^pbl_acme_/), message: expect.stringMatching(/enters it on their License page/) });
    const admin = await appAs('tenant_admin');
    // Not entered yet: hidden from the company, and the company has no valid license.
    expect((await admin.inject({ method: 'GET', url: '/v1/license/overview' })).json()).toMatchObject({ status: { state: 'grace', reason: 'none' }, licenses: [] });

    const entered = await admin.inject({ method: 'POST', url: '/v1/license/activate', payload: { licenseKey: issued.licenseKey } });
    expect(entered.statusCode).toBe(200);
    expect(entered.json()).toMatchObject({ license: { status: 'active', plan: 'starter' }, status: { state: 'active' } });
    expect((await admin.inject({ method: 'POST', url: '/v1/license/activate', payload: { licenseKey: issued.licenseKey } })).json().code).toBe('LICENSE_ALREADY_ACTIVE');
    const overview = (await admin.inject({ method: 'GET', url: '/v1/license/overview' })).json();
    expect(overview.licenses.map((l: any) => [l.status, l.plan])).toEqual([['active', 'starter']]);
    expect(JSON.stringify(overview)).not.toContain(issued.licenseKey);
  });

  it('sets no limit on users: nothing is counted, and an older client sending a number is ignored', async () => {
    const issued = await issue('tenant_acme', { maxUsers: 3 });
    expect(issued.maxUsers).toBeUndefined();
    const admin = await appAs('tenant_admin');
    await admin.inject({ method: 'POST', url: '/v1/license/activate', payload: { licenseKey: issued.licenseKey } });
    const overview = (await admin.inject({ method: 'GET', url: '/v1/license/overview' })).json();
    expect(overview.users).toBeUndefined();
    expect(overview.licenses[0].maxUsers).toBeUndefined();
  });

  it('refuses keys that are wrong, for another company, revoked or expired; only admins enter keys', async () => {
    const admin = await appAs('tenant_admin');
    const enter = (licenseKey: string) => admin.inject({ method: 'POST', url: '/v1/license/activate', payload: { licenseKey } });
    expect((await enter('pbl_acme_not-a-real-key')).json().code).toBe('INVALID_LICENSE_KEY');
    expect((await enter((await issue('tenant_other')).licenseKey)).json().code).toBe('LICENSE_FOR_ANOTHER_COMPANY');
    const revoked = await issue();
    await (await platform()).inject({ method: 'POST', url: `/v1/tenants/tenant_acme/licenses/${revoked.licenseId}/revoke`, payload: {} });
    expect((await enter(revoked.licenseKey)).json().code).toBe('LICENSE_REVOKED');
    const auditor = await appAs('tenant_auditor');
    expect((await auditor.inject({ method: 'POST', url: '/v1/license/activate', payload: { licenseKey: (await issue()).licenseKey } })).statusCode).toBe(403);
  });

  it('starts 30 days of grace when a license is revoked or removed, and stops at once when the operator says so', async () => {
    const admin = await appAs('tenant_admin');
    const a = await issue();
    await admin.inject({ method: 'POST', url: '/v1/license/activate', payload: { licenseKey: a.licenseKey } });
    const revoked = await (await platform()).inject({ method: 'POST', url: `/v1/tenants/tenant_acme/licenses/${a.licenseId}/revoke`, payload: {} });
    expect(Date.parse(revoked.json().graceUntil)).toBeGreaterThan(Date.now() + 29 * DAY);
    const status = (await admin.inject({ method: 'GET', url: '/v1/license/status' })).json();
    expect(status).toMatchObject({ state: 'grace', reason: 'revoked', daysLeft: 30 });

    const b = await issue();
    await admin.inject({ method: 'POST', url: '/v1/license/activate', payload: { licenseKey: b.licenseKey } });
    expect((await admin.inject({ method: 'GET', url: '/v1/license/status' })).json().state).toBe('active');
    expect((await admin.inject({ method: 'POST', url: `/v1/license/${b.licenseId}/remove` })).json()).toMatchObject({ status: 'removed', license: { state: 'grace' } });

    const c = await issue();
    await admin.inject({ method: 'POST', url: '/v1/license/activate', payload: { licenseKey: c.licenseKey } });
    await (await platform()).inject({ method: 'POST', url: `/v1/tenants/tenant_acme/licenses/${c.licenseId}/revoke`, payload: { graceDays: 0 } });
    // b's removal still gives grace: the latest end wins.
    expect((await admin.inject({ method: 'GET', url: '/v1/license/status' })).json().state).toBe('grace');
  });

  it('only lets platform admins see every license, issue or revoke', async () => {
    const tenantAdmin = await appAs('tenant_admin');
    expect((await tenantAdmin.inject({ method: 'GET', url: '/v1/licenses' })).statusCode).toBe(403);
    expect((await tenantAdmin.inject({ method: 'POST', url: '/v1/tenants/tenant_acme/licenses', payload: {} })).statusCode).toBe(403);
    const a = await issue();
    expect((await tenantAdmin.inject({ method: 'POST', url: `/v1/tenants/tenant_acme/licenses/${a.licenseId}/revoke`, payload: {} })).statusCode).toBe(403);
    expect((await (await platform()).inject({ method: 'GET', url: '/v1/licenses' })).json().map((l: any) => l.licenseId)).toEqual([a.licenseId]);
  });
});

describe('when a license has lapsed', () => {
  const KEY = 'pbl_acme_app_key_for_tests';
  const lapsed = { state: 'lapsed' as const, reason: 'expired' as const, graceUntil: '2026-10-01T00:00:00.000Z' };
  async function app(status: object | null) {
    const a = Fastify();
    await a.register(createAuthPlugin({
      keys: { findByHash: async (h) => (h === hashApiKey(KEY) ? { tenantId: 'tenant_acme', keyId: 'k1', keyHash: h, keyPrefix: 'pbl', name: 'App', scopes: ['chat'], status: 'active', rateLimit: 60, createdAt: '', createdBy: '' } : null), touchLastUsed: async () => {} },
      userTokens: { verify: async () => ({ sub: 'u1', 'custom:tenantId': 'tenant_acme', 'custom:role': 'tenant_admin' }) },
      licenseStatus: async () => status as never,
      devAuth: false, keyCacheTtlMs: 60_000,
    }));
    a.post('/v1/chat/completions', async () => ({ answered: true }));
    a.get('/v1/evidence', async () => ({ evidence: true }));
    return a;
  }

  it('refuses AI traffic with a clear message, but people can still sign in to the dashboard', async () => {
    const a = await app(lapsed);
    const chat = await a.inject({ method: 'POST', url: '/v1/chat/completions', headers: { authorization: `Bearer ${KEY}` }, payload: {} });
    expect(chat.statusCode).toBe(403);
    expect(chat.json()).toEqual({ code: 'LICENSE_ENDED', error: expect.stringMatching(/license has ended, and AI requests stopped on 2026-10-01/) });
    expect((await a.inject({ method: 'GET', url: '/v1/evidence', headers: { authorization: 'Bearer a.b.c' } })).json()).toEqual({ evidence: true });
  });

  it('keeps answering during the grace period, and when the license state can’t be read', async () => {
    for (const s of [{ state: 'grace', daysLeft: 3 }, null]) {
      const a = await app(s);
      expect((await a.inject({ method: 'POST', url: '/v1/chat/completions', headers: { authorization: `Bearer ${KEY}` }, payload: {} })).json()).toEqual({ answered: true });
    }
  });
});

describe('license files for customer-run installs', () => {
  const { generateKeyPairSync } = require('crypto');
  const { trustLicenseKeysForTests } = require('../licensing/license-file');
  const { OfflineLicenseState, setOfflineLicense } = require('../licensing/offline-license');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  beforeEach(async () => {
    setRecords(new MemoryStore());
    await collection('tenants').put({ tenantId: 'tenant_acme', name: 'Acme', createdAt: iso(-400) });
    process.env.LICENSE_SIGNING_KEY = privateKey.export({ format: 'pem', type: 'pkcs8' });
    trustLicenseKeysForTests([{ publicKey: publicKey.export({ format: 'pem', type: 'spki' }), label: 'test' }]);
    setOfflineLicense(new OfflineLicenseState(0));
    setAnalyticsClient({ optional: async () => null } as any);
  });
  afterEach(() => { delete process.env.LICENSE_SIGNING_KEY; delete process.env.LICENSING; trustLicenseKeysForTests(null); setOfflineLicense(null); setAnalyticsClient(null); });

  async function appAs(role: string, home: string) {
    const { tenantRoutes } = await import('../routes/tenant.routes');
    const app = Fastify();
    app.decorateRequest('principal', null);
    app.addHook('preHandler', async (req: any) => { req.principal = { kind: 'user', homeTenantId: home, userId: 'u1', role }; req.tenantId = home; req.userId = 'u1'; });
    await app.register(tenantRoutes, { prefix: '/v1' });
    return app;
  }

  it('issues a signed file for the gateway’s address, kept for our records and re-download', async () => {
    const platform = await appAs('platform_admin', 'tenant_platform');
    const missing = await platform.inject({ method: 'POST', url: '/v1/tenants/tenant_acme/licenses', payload: { type: 'onprem', plan: 'enterprise' } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toMatch(/gateway’s address/);
    const res = await platform.inject({ method: 'POST', url: '/v1/tenants/tenant_acme/licenses', payload: { type: 'onprem', plan: 'enterprise', validityDays: 365, addresses: ['AI-Gateway.Acme.com'] } });
    expect(res.statusCode).toBe(201);
    const issued = res.json();
    expect(issued).toMatchObject({ file: true, addresses: ['ai-gateway.acme.com'], plan: 'enterprise' });
    expect(issued.licenseFile).toMatch(/^PBL1\./);
    expect((await platform.inject({ method: 'GET', url: `/v1/tenants/tenant_acme/licenses/${issued.licenseId}/file` })).json().licenseFile).toBe(issued.licenseFile);
    const listed = (await platform.inject({ method: 'GET', url: '/v1/licenses' })).json();
    expect(listed).toEqual([expect.objectContaining({ licenseId: issued.licenseId, file: true, addresses: ['ai-gateway.acme.com'] })]);
    // It can't be revoked: the gateway never contacts us. Nor does it change the company's Cloud license.
    expect((await platform.inject({ method: 'POST', url: `/v1/tenants/tenant_acme/licenses/${issued.licenseId}/revoke`, payload: {} })).statusCode).toBe(409);
    expect((await (await appAs('tenant_admin', 'tenant_acme')).inject({ method: 'GET', url: '/v1/license/overview' })).json().licenses).toEqual([]);

    // On the customer's install, an admin enters it, and it's in force.
    process.env.LICENSING = 'offline';
    const customer = await appAs('tenant_admin', 'tenant_acme');
    const bad = await customer.inject({ method: 'POST', url: '/v1/license/activate', payload: { licenseKey: issued.licenseFile.slice(0, -4) + 'AAAA' } });
    expect(bad.statusCode).toBe(400);
    const ok = await customer.inject({ method: 'POST', url: '/v1/license/activate', payload: { licenseKey: issued.licenseFile } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ license: { licenseId: issued.licenseId, addresses: ['ai-gateway.acme.com'] }, status: { state: 'active', plan: 'enterprise' } });
    const overview = (await customer.inject({ method: 'GET', url: '/v1/license/overview' })).json();
    expect(overview).toMatchObject({ offline: true, licenses: [{ licenseId: issued.licenseId }] });
    expect(overview.users).toBeUndefined();
  });

  it('can’t issue files without a signing key', async () => {
    delete process.env.LICENSE_SIGNING_KEY;
    const res = await (await appAs('platform_admin', 'tenant_platform')).inject({ method: 'POST', url: '/v1/tenants/tenant_acme/licenses', payload: { type: 'onprem', addresses: ['gw.acme.com'] } });
    expect(res.statusCode).toBe(503);
  });
});
