import Fastify from 'fastify';
import { generateKeyPairSync, sign as signRaw } from 'crypto';
import { BUILT_IN_SEQUENCE, CatalogData, builtInCatalogData, catalogInfo, resetCatalog, serviceForDomain } from '@ai-governance/catalog';
import { AI_TOOLS, toolForDomain } from '@ai-governance/types';
import { MemoryStore, setRecords } from '@ai-governance/storage';
import { kidOf, signCatalogDocument, trustCatalogKeysForTests, verifyCatalogDocument } from '../catalog/catalog-document';
import { CatalogUpdater, setCatalogUpdater } from '../catalog/catalog-updater';
import { feedEntries } from '../enforcement/feed-formats';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KID = kidOf(publicKey);
const signWith = (key = privateKey) => (bytes: Buffer) => signRaw('sha256', bytes, { key, dsaEncoding: 'der' });

const NEXT = BUILT_IN_SEQUENCE + 3600;
function data(sequence = NEXT): CatalogData {
  const d = builtInCatalogData(sequence, `ed-${sequence - BUILT_IN_SEQUENCE}`);
  d.services.push({ id: 'new-chat', name: 'New Chat', vendor: 'Newco', category: 'chat', businessTerms: 'unknown', domains: ['newchat.example'], url: 'https://newchat.example' });
  return d;
}
const signed = async (d = data(), key = privateKey, kid = KID) => JSON.stringify(await signCatalogDocument(d, kid, signWith(key)));

beforeAll(() => trustCatalogKeysForTests([{ publicKey: publicKey.export({ format: 'pem', type: 'spki' }) as string, label: 'test' }]));
afterAll(() => trustCatalogKeysForTests(null));
beforeEach(() => { setRecords(new MemoryStore()); resetCatalog(); });
afterEach(() => resetCatalog());

describe('signed catalog documents', () => {
  it('verifies a catalog signed by a trusted key', async () => {
    const { data: d, kid } = verifyCatalogDocument(await signed());
    expect(kid).toBe(KID);
    expect(d.services.some((s) => s.id === 'new-chat')).toBe(true);
  });

  it('refuses a changed catalog, an unknown key, and other files', async () => {
    const doc = JSON.parse(await signed());
    const tampered = data();
    tampered.services = tampered.services.filter((s) => s.id !== 'chatgpt');
    expect(() => verifyCatalogDocument(JSON.stringify({ ...doc, payload: Buffer.from(JSON.stringify(tampered)).toString('base64url') }))).toThrow(/changed or damaged/);
    const unknownKey = await signed(data(), other.privateKey, kidOf(other.publicKey));
    expect(() => verifyCatalogDocument(unknownKey)).toThrow(/key this install trusts/);
    const wrongKey = await signed(data(), other.privateKey, KID);
    expect(() => verifyCatalogDocument(wrongKey)).toThrow(/changed or damaged/);
    expect(() => verifyCatalogDocument('PBL1.abc.def')).toThrow(/isn’t a Probaline catalog/);
    expect(() => verifyCatalogDocument(JSON.stringify({ ...doc, format: 'probaline.catalog/2' }))).toThrow(/newer version/);
  });
});

describe('catalog updates on an install', () => {
  it('applies a newer published catalog: new services reach the browser list, lookups and firewall feeds', async () => {
    const u = new CatalogUpdater({}, async () => ({ status: 200, body: await signed(), etag: '"v1"' }));
    expect(toolForDomain('newchat.example').id).toBe('domain:newchat.example');
    expect(await u.check()).toMatchObject({ result: 'updated' });
    expect(catalogInfo()).toMatchObject({ source: 'feed', sequence: NEXT });
    expect(serviceForDomain('newchat.example')?.id).toBe('new-chat');
    expect(AI_TOOLS.some((t) => t.id === 'new-chat')).toBe(true);
    expect(toolForDomain('newchat.example').id).toBe('new-chat');
    expect(feedEntries(['chat']).some((e) => e.domain === 'newchat.example')).toBe(true);
    const state = await u.state();
    expect(state).toMatchObject({ lastResult: 'updated', updates: 'auto', url: 'https://probaline.com/catalog/v1/latest.json' });
  });

  it('asks with the last ETag, and records an unchanged catalog', async () => {
    const seen: Array<string | undefined> = [];
    let first = true;
    const u = new CatalogUpdater({}, async (_url, etag) => {
      seen.push(etag);
      if (first) { first = false; return { status: 200, body: await signed(), etag: '"v1"' }; }
      return { status: 304 };
    });
    await u.check();
    expect(await u.check()).toMatchObject({ result: 'unchanged' });
    expect(seen).toEqual([undefined, '"v1"']);
  });

  it('keeps the catalog in use when a download is bad, and says why', async () => {
    const u = new CatalogUpdater({}, async () => ({ status: 200, body: await signed(data(), other.privateKey, kidOf(other.publicKey)) }));
    expect(await u.check()).toMatchObject({ result: 'error' });
    expect(catalogInfo().source).toBe('built-in');
    expect((await u.state()).lastError).toMatch(/key this install trusts/);
    const down = new CatalogUpdater({}, async () => { throw new Error('getaddrinfo ENOTFOUND'); });
    expect(await down.check()).toMatchObject({ result: 'error', message: expect.stringContaining('ENOTFOUND') });
  });

  it('never goes back to an older catalog, from the feed or an upload', async () => {
    const u = new CatalogUpdater({}, async () => ({ status: 404 }));
    expect(await u.accept(await signed(data(NEXT + 10)), 'upload')).toMatchObject({ result: 'updated' });
    expect(await u.accept(await signed(data(NEXT)), 'feed')).toMatchObject({ result: 'not-newer' });
    expect(catalogInfo().sequence).toBe(NEXT + 10);
  });

  it('shares the stored catalog with the other copies of the gateway', async () => {
    await new CatalogUpdater({}, async () => ({ status: 200, body: await signed() })).check();
    resetCatalog(); // another copy, still on the built-in list
    expect(serviceForDomain('newchat.example')).toBeUndefined();
    expect(await new CatalogUpdater({ CATALOG_UPDATES: 'off' }).reload()).toBe(true);
    expect(serviceForDomain('newchat.example')?.id).toBe('new-chat');
  });
});

describe('catalog routes', () => {
  async function appAs(role: string, env: Record<string, string> = {}) {
    jest.resetModules();
    Object.assign(process.env, env);
    const { catalogRoutes } = await import('../routes/catalog.routes');
    const updater = await import('../catalog/catalog-updater');
    const doc = await import('../catalog/catalog-document');
    doc.trustCatalogKeysForTests([{ publicKey: publicKey.export({ format: 'pem', type: 'spki' }) as string, label: 'test' }]);
    updater.setCatalogUpdater(new updater.CatalogUpdater({}, async () => ({ status: 304 })));
    const app = Fastify();
    app.decorateRequest('principal', null);
    app.addHook('preHandler', async (req: any) => {
      req.principal = { kind: 'user', homeTenantId: 'tenant_acme', userId: 'u1', role };
      req.tenantId = 'tenant_acme';
      req.userId = 'u1';
    });
    await app.register(catalogRoutes, { prefix: '/v1' });
    return app;
  }
  afterEach(() => { delete process.env.LICENSING; setCatalogUpdater(null); });

  it('lets admins and auditors see the catalog in use', async () => {
    const res = await (await appAs('tenant_auditor')).inject({ method: 'GET', url: '/v1/catalog' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ source: 'built-in', updates: 'auto' });
  });

  it('in Cloud, only the platform admin changes the shared catalog', async () => {
    const app = await appAs('tenant_admin');
    expect((await app.inject({ method: 'POST', url: '/v1/catalog/upload', payload: { document: await signed() } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/v1/catalog/check' })).statusCode).toBe(403);
  });

  it('on a customer-run install, the company admin uploads a catalog file; a bad file is refused', async () => {
    const app = await appAs('tenant_admin', { LICENSING: 'offline' });
    const bad = await app.inject({ method: 'POST', url: '/v1/catalog/upload', payload: { document: '{"format":"x"}' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('CATALOG_MALFORMED');
    const ok = await app.inject({ method: 'POST', url: '/v1/catalog/upload', payload: { document: await signed() } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ result: 'updated', catalog: { source: 'upload' } });
    expect((await app.inject({ method: 'POST', url: '/v1/catalog/upload', payload: { document: await signed() } })).json().result).toBe('not-newer');
    expect((await app.inject({ method: 'POST', url: '/v1/catalog/check' })).json()).toMatchObject({ result: 'unchanged' });
  });
});

describe('the download itself', () => {
  it('sends no credentials or install details, only a plain user agent and the last ETag', async () => {
    const http = await import('http');
    const seen: Record<string, unknown>[] = [];
    const body = await signed();
    const server = http.createServer((req, res) => { seen.push({ ...req.headers }); res.writeHead(200, { etag: '"v9"', 'content-type': 'application/json' }); res.end(body); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const u = new CatalogUpdater({ CATALOG_URL: `http://127.0.0.1:${port}/catalog/v1/latest.json` });
      expect(await u.check()).toMatchObject({ result: 'updated' });
      const h = seen[0];
      expect(h['user-agent']).toBe('Probaline');
      const allowed = new Set(['host', 'user-agent', 'accept', 'accept-encoding', 'connection', 'if-none-match']);
      expect(Object.keys(h).filter((k) => !allowed.has(k))).toEqual([]);
    } finally {
      server.close();
    }
  });

  it('refuses a plain-http catalog address other than this machine', async () => {
    const u = new CatalogUpdater({ CATALOG_URL: 'http://catalog.example.com/latest.json' });
    expect(await u.check()).toMatchObject({ result: 'error', message: expect.stringContaining('https') });
  });
});
