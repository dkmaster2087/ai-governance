import Fastify from 'fastify';
import { MemoryStore, setRecords } from '@ai-governance/storage';
import { createAuthPlugin } from '../middleware/auth.middleware';
import { requireAccess } from '../auth/guards';
import { ApiKey, hashApiKey } from '../repositories/api-key.repository';
import { RateCounter } from '../services/rate-counter';
import { KeySpend, keySpend, setKeySpend } from '../services/key-spend';

const RAW = 'pbl_acme_rate';
const KEY: ApiKey = {
  tenantId: 'tenant_acme', keyId: 'k_rate', keyHash: hashApiKey(RAW), keyPrefix: 'pbl_acme', name: 'app',
  scopes: ['chat'], status: 'active', rateLimit: 3, createdAt: '', createdBy: 'test',
};

/** Two gateway instances sharing one database. */
async function instance() {
  const app = Fastify();
  await app.register(createAuthPlugin({
    keys: { findByHash: async (h) => (h === KEY.keyHash ? KEY : null), touchLastUsed: async () => {} },
    rate: new RateCounter(), devAuth: false, keyCacheTtlMs: 60_000,
  }));
  app.post('/v1/chat/completions', { preHandler: requireAccess({ scopes: ['chat'] }) }, async () => ({ ok: true }));
  return app;
}

describe('per-key rate limits', () => {
  beforeEach(() => setRecords(new MemoryStore()));

  it('counts a key\'s calls across every gateway instance and refuses over its limit', async () => {
    const [a, b] = [await instance(), await instance()];
    const call = (app: typeof a) => app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { authorization: `Bearer ${RAW}` }, payload: {} });
    expect((await call(a)).headers['x-ratelimit-remaining']).toBe('2');
    expect((await call(b)).statusCode).toBe(200);
    expect((await call(a)).statusCode).toBe(200);
    const over = await call(b);
    expect(over.statusCode).toBe(429);
    expect(over.json().code).toBe('RATE_LIMITED');
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('starts again the next minute, and lets traffic through if the counters can\'t be reached', async () => {
    const r = new RateCounter();
    const t = Math.floor(Date.now() / 60_000) * 60_000 + 30_000;
    for (let i = 0; i < 3; i++) await r.hit('t', 'key#x', 3, t);
    expect((await r.hit('t', 'key#x', 3, t)).allowed).toBe(false);
    expect((await r.hit('t', 'key#x', 3, t + 60_000)).allowed).toBe(true);
    setRecords({ } as never);
    expect((await r.hit('t', 'key#x', 1, t)).allowed).toBe(true);
  });
});

describe('daily caps per key', () => {
  beforeEach(() => { setRecords(new MemoryStore()); setKeySpend(new KeySpend()); });
  afterAll(() => setKeySpend(null));
  const CAPPED: ApiKey = { ...KEY, keyId: 'k_cap', keyHash: hashApiKey('pbl_acme_cap'), rateLimit: 1000, dailyTokenLimit: 1000, dailySpendLimitUsd: 2 };

  async function app() {
    const a = Fastify();
    await a.register(createAuthPlugin({
      keys: { findByHash: async (h) => (h === CAPPED.keyHash ? CAPPED : null), touchLastUsed: async () => {} },
      rate: new RateCounter(), devAuth: false, keyCacheTtlMs: 60_000,
    }));
    a.post('/v1/chat/completions', { preHandler: requireAccess({ scopes: ['chat'] }) }, async () => ({ ok: true }));
    a.post('/v1/proxy/openai/v1/chat/completions', { preHandler: requireAccess({ scopes: ['chat'] }) }, async () => ({ ok: true }));
    a.get('/v1/models', { preHandler: requireAccess({ scopes: ['chat'] }) }, async () => ({ ok: true }));
    return a;
  }
  const headers = { authorization: 'Bearer pbl_acme_cap' };

  it('refuses AI requests once a key has used its tokens for the day, and counts across copies', async () => {
    const [a, b] = [await app(), await app()];
    expect((await a.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload: {} })).statusCode).toBe(200);
    await keySpend().record('tenant_acme', 'k_cap', 600, 0.1);
    await keySpend().record('tenant_acme', 'k_cap', 500, 0.1);
    const over = await b.inject({ method: 'POST', url: '/v1/proxy/openai/v1/chat/completions', headers: { 'x-probaline-key': 'pbl_acme_cap' }, payload: {} });
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ code: 'DAILY_LIMIT', error: expect.stringMatching(/used its 1,000 tokens for today/) });
    // Other requests from the key still work.
    expect((await a.inject({ method: 'GET', url: '/v1/models', headers })).statusCode).toBe(200);
  });

  it('refuses once the estimated spend reaches the cap, and only counts keys that have caps', async () => {
    const a = await app();
    await a.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload: {} });
    await keySpend().record('tenant_acme', 'k_cap', 10, 2.5);
    expect((await a.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload: {} })).json().error).toMatch(/\$2 spending limit/);
    await keySpend().record('tenant_acme', 'k_uncapped', 10, 5);
    expect(await keySpend().today('tenant_acme', 'k_uncapped')).toEqual({ tokens: 0, spendUsd: 0 });
    // The next UTC day starts afresh.
    const tomorrow = Date.now() + 86_400_000;
    expect(await keySpend().refusal('tenant_acme', 'k_cap', { dailyTokenLimit: 1000 }, tomorrow)).toBeNull();
  });
});
