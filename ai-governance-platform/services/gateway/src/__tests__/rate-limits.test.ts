import Fastify from 'fastify';
import { MemoryStore, setRecords } from '@ai-governance/storage';
import { createAuthPlugin } from '../middleware/auth.middleware';
import { requireAccess } from '../auth/guards';
import { ApiKey, hashApiKey } from '../repositories/api-key.repository';
import { RateCounter } from '../services/rate-counter';

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
    // A key already known to be over is refused without another write; one the counters can't count isn't stopped.
    setRecords({ } as never);
    expect((await r.hit('t', 'key#x', 3, t)).allowed).toBe(false);
    expect((await r.hit('t', 'key#y', 1, t)).allowed).toBe(true);
  });
});
