import { generateApiKey, hashApiKey } from '../repositories/api-key.repository';

describe('API Key Management', () => {
  describe('generateApiKey', () => {
    it('generates a key with correct format', () => {
      const result = generateApiKey('tenant_demo');
      expect(result.raw).toMatch(/^aegis_demo_[a-f0-9]{48}$/);
      expect(result.prefix).toMatch(/^aegis_demo_[a-f0-9].*\.\.\.$/);
      expect(result.keyId).toMatch(/^key_[a-f0-9]{16}$/);
      expect(result.hash).toHaveLength(64); // SHA-256 hex
    });

    it('generates unique keys each time', () => {
      const key1 = generateApiKey('tenant_demo');
      const key2 = generateApiKey('tenant_demo');
      expect(key1.raw).not.toBe(key2.raw);
      expect(key1.hash).not.toBe(key2.hash);
      expect(key1.keyId).not.toBe(key2.keyId);
    });

    it('uses tenant prefix in key', () => {
      const result = generateApiKey('tenant_healthco');
      expect(result.raw.startsWith('aegis_health')).toBe(true);
    });

    it('truncates long tenant names', () => {
      const result = generateApiKey('tenant_verylongtenant');
      expect(result.raw.startsWith('aegis_verylo')).toBe(true);
    });
  });

  describe('hashApiKey', () => {
    it('produces consistent hash for same input', () => {
      const hash1 = hashApiKey('aegis_demo_abc123');
      const hash2 = hashApiKey('aegis_demo_abc123');
      expect(hash1).toBe(hash2);
    });

    it('produces different hash for different input', () => {
      const hash1 = hashApiKey('aegis_demo_abc123');
      const hash2 = hashApiKey('aegis_demo_xyz789');
      expect(hash1).not.toBe(hash2);
    });

    it('returns 64-char hex string (SHA-256)', () => {
      const hash = hashApiKey('test-key');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('key validation logic', () => {
    it('generated key hash matches hashApiKey of raw key', () => {
      const { raw, hash } = generateApiKey('tenant_test');
      expect(hashApiKey(raw)).toBe(hash);
    });
  });
});

describe('API key routes', () => {
  const repo = {
    getForTenant: jest.fn(), create: jest.fn(), revoke: jest.fn(), delete: jest.fn(), findByHash: jest.fn(), touchLastUsed: jest.fn(),
  };
  jest.doMock('../repositories/api-key.repository', () => ({
    ...jest.requireActual('../repositories/api-key.repository'),
    ApiKeyRepository: jest.fn(() => repo),
  }));

  async function app() {
    const Fastify = (await import('fastify')).default;
    const { apiKeyRoutes } = await import('../routes/api-key.routes');
    const a = Fastify();
    a.decorateRequest('principal', null);
    a.addHook('preHandler', async (req: any) => {
      req.principal = { kind: 'user', homeTenantId: 't', userId: 'u', role: 'tenant_admin' };
      req.tenantId = 't';
      req.userId = 'u';
    });
    await a.register(apiKeyRoutes, { prefix: '/v1' });
    return a;
  }

  const key = (keyId: string, scopes: string[]) => ({ tenantId: 't', keyId, keyHash: 'h', keyPrefix: 'p', name: keyId, scopes, status: 'active', rateLimit: 1, createdAt: '2026-01-01', createdBy: 'u' });

  beforeEach(() => {
    jest.clearAllMocks();
    repo.getForTenant.mockResolvedValue([key('app', ['chat']), key('license', ['reporting:ingest'])]);
  });

  it('hides license keys from the tenant list', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/v1/api-keys' });
    expect(res.json().map((k: any) => k.keyId)).toEqual(['app']);
  });

  it('will not rotate, revoke or delete a license key', async () => {
    const a = await app();
    for (const url of ['/v1/api-keys/license/rotate', '/v1/api-keys/license/revoke']) {
      expect((await a.inject({ method: 'POST', url })).statusCode).toBe(404);
    }
    expect((await a.inject({ method: 'DELETE', url: '/v1/api-keys/license' })).statusCode).toBe(404);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.revoke).not.toHaveBeenCalled();
  });

  it('returns 404 instead of creating a record for an unknown key', async () => {
    const res = await (await app()).inject({ method: 'POST', url: '/v1/api-keys/nope/revoke' });
    expect(res.statusCode).toBe(404);
    expect(repo.revoke).not.toHaveBeenCalled();
  });

  it('revokes the tenant’s own key', async () => {
    const res = await (await app()).inject({ method: 'POST', url: '/v1/api-keys/app/revoke' });
    expect(res.statusCode).toBe(200);
    expect(repo.revoke).toHaveBeenCalledWith('t', 'app');
  });
});
