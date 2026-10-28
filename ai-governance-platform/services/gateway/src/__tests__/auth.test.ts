import Fastify, { FastifyInstance } from 'fastify';
import { createAuthPlugin, UserTokenClaims } from '../middleware/auth.middleware';
import { requireAccess, requireTenantParam, PLATFORM_ADMIN, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { ApiKey, hashApiKey } from '../repositories/api-key.repository';
import { getSecurityConfig } from '../config/security';

const ACME_KEY = 'aegis_acme_chat';
const ACME_INGEST_KEY = 'aegis_acme_ingest';
const REVOKED_KEY = 'aegis_acme_revoked';
const EXPIRED_KEY = 'aegis_acme_expired';

function key(raw: string, overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    tenantId: 'tenant_acme', keyId: `key_${raw}`, keyHash: hashApiKey(raw), keyPrefix: raw.slice(0, 8),
    name: 'test', scopes: ['chat', 'models'], status: 'active', rateLimit: 100,
    createdAt: new Date().toISOString(), createdBy: 'test', ...overrides,
  };
}

const KEYS = new Map<string, ApiKey>([
  [hashApiKey(ACME_KEY), key(ACME_KEY)],
  [hashApiKey(ACME_INGEST_KEY), key(ACME_INGEST_KEY, { scopes: ['shadow_ai:ingest'] })],
  [hashApiKey(REVOKED_KEY), key(REVOKED_KEY, { status: 'revoked' })],
  [hashApiKey(EXPIRED_KEY), key(EXPIRED_KEY, { expiresAt: '2020-01-01T00:00:00Z' })],
]);

// Fake "JWTs": the verifier maps a token to claims, or throws for unknown tokens.
const USERS: Record<string, UserTokenClaims> = {
  'acme.admin.jwt': { sub: 'u1', 'custom:tenantId': 'tenant_acme', 'custom:role': 'tenant_admin' },
  'acme.user.jwt': { sub: 'u2', 'custom:tenantId': 'tenant_acme', 'custom:role': 'tenant_user' },
  'acme.auditor.jwt': { sub: 'u3', 'custom:tenantId': 'tenant_acme', 'custom:role': 'tenant_auditor' },
  'platform.admin.jwt': { sub: 'u4', 'custom:tenantId': 'tenant_platform', 'custom:role': 'platform_admin' },
  'no.role.jwt': { sub: 'u5', 'custom:tenantId': 'tenant_acme' },
};

const SUSPENDED_KEY = 'aegis_gone_chat';
KEYS.set(hashApiKey(SUSPENDED_KEY), key(SUSPENDED_KEY, { tenantId: 'tenant_gone' }));
USERS['gone.admin.jwt'] = { sub: 'u6', 'custom:tenantId': 'tenant_gone', 'custom:role': 'tenant_admin' };

async function buildTestApp(opts: { devAuth?: boolean; withUserTokens?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(createAuthPlugin({
    keys: {
      findByHash: async (h) => KEYS.get(h) ?? null,
      touchLastUsed: async () => {},
    },
    userTokens: opts.withUserTokens === false ? undefined : {
      verify: async (t) => {
        if (!USERS[t]) throw new Error('bad token');
        return USERS[t];
      },
    },
    tenantStatus: async (tenantId) => (tenantId === 'tenant_gone' ? 'suspended' : 'active'),
    devAuth: opts.devAuth ?? false,
    keyCacheTtlMs: 60_000,
  }));

  const echo = async (request: any) => ({ tenantId: request.tenantId, userId: request.userId, kind: request.principal.kind });
  app.get('/health', async () => ({ ok: true }));
  app.post('/v1/chat/completions', { preHandler: requireAccess({ roles: ['tenant_admin', 'tenant_auditor', 'tenant_user'], scopes: ['chat'] }) }, echo);
  app.get('/v1/tenants', { preHandler: requireAccess(PLATFORM_ADMIN) }, echo);
  app.post('/v1/api-keys', { preHandler: requireAccess(TENANT_ADMIN) }, echo);
  app.get('/v1/cost/summary/:tenantId', { preHandler: [requireAccess(TENANT_READ), requireTenantParam] }, echo);
  app.post('/v1/shadow-ai/events', { preHandler: requireAccess({ scopes: ['shadow_ai:ingest'] }) }, echo);
  app.post('/v1/proxy/openai/v1/chat/completions', { preHandler: requireAccess({ scopes: ['chat'] }) }, async (request) => ({
    tenantId: request.tenantId,
    forwardedAuth: request.headers.authorization,
  }));
  app.post('/v1/reporting/ingest', async () => ({ reachedHandler: true }));
  return app;
}

const bearer = (t: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${t}`, ...extra });

describe('gateway auth', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildTestApp(); });
  afterAll(async () => { await app.close(); });

  describe('API keys', () => {
    it('rejects requests with no credentials', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/chat/completions' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects unknown keys (no dev fall-through)', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: bearer('aegis_made_up', { 'x-tenant-id': 'tenant_acme' }) });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('INVALID_KEY');
    });

    it('takes the tenant from the key, not from headers', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: bearer(ACME_KEY) });
      expect(res.statusCode).toBe(200);
      expect(res.json().tenantId).toBe('tenant_acme');
    });

    it('rejects a key used against another tenant', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: bearer(ACME_KEY, { 'x-tenant-id': 'tenant_other' }) });
      expect(res.statusCode).toBe(403);
    });

    it('rejects revoked and expired keys', async () => {
      expect((await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: bearer(REVOKED_KEY) })).json().code).toBe('KEY_REVOKED');
      expect((await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: bearer(EXPIRED_KEY) })).json().code).toBe('KEY_EXPIRED');
    });

    it('enforces scopes', async () => {
      const ingestOnChat = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: bearer(ACME_INGEST_KEY) });
      expect(ingestOnChat.statusCode).toBe(403);
      const chatOnIngest = await app.inject({ method: 'POST', url: '/v1/shadow-ai/events', headers: bearer(ACME_KEY) });
      expect(chatOnIngest.statusCode).toBe(403);
      const ingest = await app.inject({ method: 'POST', url: '/v1/shadow-ai/events', headers: bearer(ACME_INGEST_KEY) });
      expect(ingest.statusCode).toBe(200);
    });

    it('cannot reach admin routes', async () => {
      expect((await app.inject({ method: 'GET', url: '/v1/tenants', headers: bearer(ACME_KEY) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/v1/api-keys', headers: bearer(ACME_KEY) })).statusCode).toBe(403);
    });

    it('cannot read another tenant via a URL parameter', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/cost/summary/tenant_other', headers: bearer('acme.admin.jwt') });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('dashboard users', () => {
    it('rejects invalid tokens', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/tenants', headers: bearer('forged.token.jwt') });
      expect(res.statusCode).toBe(401);
    });

    it('rejects users with no role assigned', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: bearer('no.role.jwt') });
      expect(res.statusCode).toBe(403);
    });

    it('only lets platform admins list tenants', async () => {
      expect((await app.inject({ method: 'GET', url: '/v1/tenants', headers: bearer('acme.admin.jwt') })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: '/v1/tenants', headers: bearer('platform.admin.jwt') })).statusCode).toBe(200);
    });

    it('stops a tenant admin from switching tenants with x-tenant-id', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/api-keys', headers: bearer('acme.admin.jwt', { 'x-tenant-id': 'tenant_other' }) });
      expect(res.statusCode).toBe(403);
    });

    it('lets a platform admin act on another tenant', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/api-keys', headers: bearer('platform.admin.jwt', { 'x-tenant-id': 'tenant_acme' }) });
      expect(res.statusCode).toBe(200);
      expect(res.json().tenantId).toBe('tenant_acme');
    });

    it('applies role rules', async () => {
      expect((await app.inject({ method: 'POST', url: '/v1/api-keys', headers: bearer('acme.user.jwt') })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/v1/api-keys', headers: bearer('acme.auditor.jwt') })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: '/v1/cost/summary/tenant_acme', headers: bearer('acme.auditor.jwt') })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/v1/cost/summary/tenant_acme', headers: bearer('acme.user.jwt') })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: bearer('acme.user.jwt') })).statusCode).toBe(200);
    });

    it('rejects user tokens when Cognito is not configured', async () => {
      const noCognito = await buildTestApp({ withUserTokens: false });
      const res = await noCognito.inject({ method: 'GET', url: '/v1/tenants', headers: bearer('platform.admin.jwt') });
      expect(res.statusCode).toBe(401);
      await noCognito.close();
    });
  });

  describe('suspended tenants', () => {
    it('refuses their API keys and users, but not platform admins', async () => {
      expect((await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: bearer(SUSPENDED_KEY) })).json().code).toBe('TENANT_SUSPENDED');
      expect((await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: bearer('gone.admin.jwt') })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/v1/api-keys', headers: bearer('platform.admin.jwt', { 'x-tenant-id': 'tenant_gone' }) })).statusCode).toBe(200);
    });
  });

  describe('proxy mode', () => {
    it('authenticates with x-aegis-key and leaves Authorization for the provider', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/proxy/openai/v1/chat/completions',
        headers: { 'x-aegis-key': ACME_KEY, authorization: 'Bearer sk-provider-key' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ tenantId: 'tenant_acme', forwardedAuth: 'Bearer sk-provider-key' });
    });

    it('rejects proxy calls without an Aegis key', async () => {
      const res = await app.inject({
        method: 'POST', url: '/v1/proxy/openai/v1/chat/completions',
        headers: { authorization: `Bearer ${ACME_KEY}` },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('public and license routes', () => {
    it('leaves health and license-authenticated routes to their handlers', async () => {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: '/v1/reporting/ingest', payload: {} })).json()).toEqual({ reachedHandler: true });
    });
  });

  describe('dev mode', () => {
    it('rejects test-key unless dev mode is on', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: bearer('test-key', { 'x-tenant-id': 'tenant_acme' }) });
      expect(res.statusCode).toBe(401);
    });

    it('accepts test-key with a dev role when dev mode is on', async () => {
      const dev = await buildTestApp({ devAuth: true });
      const res = await dev.inject({ method: 'GET', url: '/v1/tenants', headers: bearer('test-key', { 'x-tenant-id': 'tenant_platform', 'x-dev-role': 'platform_admin' }) });
      expect(res.statusCode).toBe(200);
      const asUser = await dev.inject({ method: 'GET', url: '/v1/tenants', headers: bearer('test-key', { 'x-tenant-id': 'tenant_acme', 'x-dev-role': 'tenant_user' }) });
      expect(asUser.statusCode).toBe(403);
      await dev.close();
    });

    it('refuses to start with AUTH_DEV_MODE in production', () => {
      const prev = { stage: process.env.STAGE, dev: process.env.AUTH_DEV_MODE };
      process.env.STAGE = 'prod';
      process.env.AUTH_DEV_MODE = 'true';
      try {
        expect(() => getSecurityConfig()).toThrow(/AUTH_DEV_MODE/);
      } finally {
        process.env.STAGE = prev.stage;
        process.env.AUTH_DEV_MODE = prev.dev;
        if (prev.stage === undefined) delete process.env.STAGE;
        if (prev.dev === undefined) delete process.env.AUTH_DEV_MODE;
      }
    });
  });
});
