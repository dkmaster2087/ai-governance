import Fastify from 'fastify';
import { gunzipSync } from 'zlib';
import { MemoryObjectStore, MemoryStore, setObjects, setRecords, collection } from '@ai-governance/storage';
import { AuditLog } from '@ai-governance/types';
import { HotCache } from '../services/hot-cache';
import { BatchedCounter } from '../services/batched-counter';
import { RateCounter } from '../services/rate-counter';
import { ArchiveBatcher } from '../services/archive-batcher';
import { loadShedding } from '../middleware/load-shedding';

describe('hot cache', () => {
  it('reads once per key until it expires, shares a load in progress, and forgets on demand', async () => {
    const cache = new HotCache<number>(60_000);
    let loads = 0;
    const load = async () => ++loads;
    const [a, b] = await Promise.all([cache.get('t', load), cache.get('t', load)]);
    expect([a, b, loads]).toEqual([1, 1, 1]);
    expect(await cache.get('t', load)).toBe(1);
    cache.forget('t');
    expect(await cache.get('t', load)).toBe(2);
  });

  it('does not keep a failed load, or a value it is told not to keep', async () => {
    const cache = new HotCache<number[]>(60_000, 100, (v) => v.length > 0);
    await expect(cache.get('t', async () => { throw new Error('down'); })).rejects.toThrow('down');
    expect(await cache.get('t', async () => [])).toEqual([]);
    expect(await cache.get('t', async () => [1])).toEqual([1]);
    expect(await cache.get('t', async () => [2])).toEqual([1]);
  });
});

describe('batched counters', () => {
  beforeEach(() => setRecords(new MemoryStore()));
  const stored = async (period: string) => (await collection<{ tenantId: string; period: string; count?: number }>('metrics').get({ tenantId: 't', period }))?.count;

  it('writes the first use at once, then adds up locally and writes the sum in one go', async () => {
    const c = new BatchedCounter(60_000);
    expect(await c.add('t', 'p', 1, 60)).toBe(1);
    for (let i = 0; i < 9; i++) await c.add('t', 'p', 1, 60);
    expect(await stored('p')).toBe(1);
    expect(c.estimate('t', 'p')).toBe(10);
    await c.flush();
    expect(await stored('p')).toBe(10);
  });

  it('fires a threshold exactly once across two copies', async () => {
    const [a, b] = [new BatchedCounter(60_000), new BatchedCounter(60_000)];
    const fired: number[] = [];
    const onWritten = async (total: number, added: number) => { if (total - added < 5 && total >= 5) fired.push(total); };
    for (let i = 0; i < 3; i++) await a.addLater('t', 'alert', 1, 60, onWritten);
    for (let i = 0; i < 3; i++) await b.addLater('t', 'alert', 1, 60, onWritten);
    await a.flush();
    await b.flush();
    for (let i = 0; i < 4; i++) await a.addLater('t', 'alert', 1, 60, onWritten);
    await a.flush();
    expect(fired).toEqual([6]);
    expect(await stored('alert')).toBe(10);
  });

  it('keeps a count whose handler fails, without counting it twice', async () => {
    const c = new BatchedCounter(60_000);
    await c.addLater('t', 'x', 2, 60, async () => { throw new Error('webhook down'); });
    await c.flush();
    await c.flush();
    expect(await stored('x')).toBe(2);
  });

  it('counts small or nearly-reached limits exactly across copies, and big ones in batches', async () => {
    const [a, b] = [new RateCounter(new BatchedCounter(60_000)), new RateCounter(new BatchedCounter(60_000))];
    // A limit of 3: every call written, so the fourth is refused whichever copy takes it.
    for (const r of [a, b, a]) expect((await r.count('t', 'small', 3, 60)).allowed).toBe(true);
    expect((await b.count('t', 'small', 3, 60)).allowed).toBe(false);
    // A limit of 1,000: after the first call, nothing is written until the batch.
    for (let i = 0; i < 50; i++) await a.count('t', 'big', 1000, 60);
    expect(await stored('big')).toBe(1);
  });
});

describe('archive copies', () => {
  const log = (tenantId: string, i: number): AuditLog => ({
    logId: `l${i}`, requestId: `r${i}`, tenantId, userId: 'u', appId: 'a', eventType: 'request_allowed', provider: 'openai', modelId: 'm',
    promptHash: 'h', responseHash: '', policyDecision: 'allow', triggeredRules: [], piiDetected: false, piiTypes: [],
    inputTokens: 0, outputTokens: 0, estimatedCost: 0, latencyMs: 0, timestamp: '2026-11-12T10:00:00.000Z', metadata: {},
  });

  it('writes one gzipped JSON Lines file per company and day, under the prefix retention deletes by', async () => {
    const store = new MemoryObjectStore();
    setObjects(store);
    const batcher = new ArchiveBatcher(() => 'b', 60_000);
    for (let i = 0; i < 3; i++) await batcher.add(log('acme', i));
    await batcher.add(log('other', 9));
    await batcher.flush();
    const keys = await store.list('logs/acme/2026-11-12/');
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/batch-.*\.jsonl\.gz$/);
    const lines = gunzipSync((await store.get(keys[0]))!).toString().trim().split('\n').map((l) => JSON.parse(l).requestId);
    expect(lines).toEqual(['r0', 'r1', 'r2']);
    expect(await store.list('logs/other/')).toHaveLength(1);
    setObjects(null);
  });

  it('keeps records that failed to write and writes them next time', async () => {
    const store = new MemoryObjectStore();
    let fail = true;
    setObjects({ kind: 'memory', put: async (k: string, b: Buffer) => { if (fail) throw new Error('S3 down'); return store.put(k, b); }, get: (k: string) => store.get(k), list: (p: string) => store.list(p), deletePrefix: (p: string) => store.deletePrefix(p) } as never);
    const batcher = new ArchiveBatcher(() => 'b', 60_000);
    await batcher.add(log('acme', 1));
    await batcher.flush();
    expect(await store.list('logs/')).toHaveLength(0);
    fail = false;
    await batcher.flush();
    expect(await store.list('logs/acme/')).toHaveLength(1);
    setObjects(null);
  });
});

describe('load shedding', () => {
  async function app(lag: { ms: number }, maxOpen = 100) {
    const a = Fastify();
    await a.register(loadShedding, { lag: () => lag.ms, maxOpen });
    a.post('/v1/chat/completions', async () => ({ ok: true }));
    a.get('/v1/rules', async () => ({ ok: true }));
    return a;
  }

  it('refuses new AI requests while the copy is saturated, and keeps other pages up', async () => {
    const lag = { ms: 900 };
    const a = await app(lag);
    const busy = await a.inject({ method: 'POST', url: '/v1/chat/completions' });
    expect(busy.statusCode).toBe(503);
    expect(busy.json().code).toBe('BUSY');
    expect(busy.headers['retry-after']).toBe('1');
    expect((await a.inject({ method: 'GET', url: '/v1/rules' })).statusCode).toBe(200);
    lag.ms = 5;
    expect((await a.inject({ method: 'POST', url: '/v1/chat/completions' })).statusCode).toBe(200);
  });

  it('counts open AI requests and frees each one when it ends', async () => {
    const a = await app({ ms: 0 }, 1);
    for (let i = 0; i < 3; i++) expect((await a.inject({ method: 'POST', url: '/v1/chat/completions' })).statusCode).toBe(200);
  });
});
