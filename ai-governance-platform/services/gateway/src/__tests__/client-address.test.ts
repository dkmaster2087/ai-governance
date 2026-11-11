import { clientAddress, clientAddressConfig, EDGE_HEADER } from '../middleware/client-address';

const req = (headers: Record<string, string | string[]> = {}, remote = '10.0.1.5') => ({ headers, socket: { remoteAddress: remote } }) as any;

describe('client address', () => {
  it('uses the connection when no proxy is trusted, whatever the header says', () => {
    const cfg = clientAddressConfig({});
    expect(clientAddress(req({ 'x-forwarded-for': '1.2.3.4' }, '203.0.113.9'), cfg)).toBe('203.0.113.9');
  });

  it('behind the load balancer, believes only the entry it added', () => {
    const cfg = clientAddressConfig({ TRUSTED_PROXY_HOPS: '1' });
    // The caller wrote 1.2.3.4; the load balancer appended the address it saw.
    expect(clientAddress(req({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7' }), cfg)).toBe('198.51.100.7');
    expect(clientAddress(req({ 'x-forwarded-for': '198.51.100.7' }), cfg)).toBe('198.51.100.7');
  });

  it('through CloudFront with the right secret, gives the browser, not the CloudFront location', () => {
    const cfg = clientAddressConfig({ TRUSTED_PROXY_HOPS: '1', EDGE_SECRET: 'edge-secret-value' });
    const xff = '1.2.3.4, 198.51.100.7, 130.176.0.10'; // spoofed, viewer (added by CloudFront), edge (added by the load balancer)
    expect(clientAddress(req({ 'x-forwarded-for': xff, [EDGE_HEADER]: 'edge-secret-value' }), cfg)).toBe('198.51.100.7');
  });

  it('a wrong or missing secret earns no extra hop', () => {
    const cfg = clientAddressConfig({ TRUSTED_PROXY_HOPS: '1', EDGE_SECRET: 'edge-secret-value' });
    const xff = '1.2.3.4, 198.51.100.7';
    expect(clientAddress(req({ 'x-forwarded-for': xff, [EDGE_HEADER]: 'guess' }), cfg)).toBe('198.51.100.7');
    expect(clientAddress(req({ 'x-forwarded-for': xff, [EDGE_HEADER]: ['edge-secret-value', 'x'] }), cfg)).toBe('198.51.100.7');
    expect(clientAddress(req({ 'x-forwarded-for': xff }), cfg)).toBe('198.51.100.7');
  });

  it('the secret alone does nothing when no proxy is trusted', () => {
    const cfg = clientAddressConfig({ EDGE_SECRET: 'edge-secret-value' });
    expect(clientAddress(req({ 'x-forwarded-for': '1.2.3.4', [EDGE_HEADER]: 'edge-secret-value' }, '203.0.113.9'), cfg)).toBe('203.0.113.9');
  });

  it('a request that skipped the proxies falls back to the connection', () => {
    const cfg = clientAddressConfig({ TRUSTED_PROXY_HOPS: '2' });
    expect(clientAddress(req({ 'x-forwarded-for': '1.2.3.4' }, '203.0.113.9'), cfg)).toBe('203.0.113.9');
    expect(clientAddress(req({}, '203.0.113.9'), cfg)).toBe('203.0.113.9');
  });

  it('refuses a hop count that makes no sense', () => {
    expect(() => clientAddressConfig({ TRUSTED_PROXY_HOPS: 'all' })).toThrow();
    expect(() => clientAddressConfig({ TRUSTED_PROXY_HOPS: '-1' })).toThrow();
  });
});

describe('the gateway limit per address', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; jest.resetModules(); });

  it("can't be dodged by writing a different X-Forwarded-For each time", async () => {
    process.env.GLOBAL_RATE_LIMIT = '3';
    process.env.TRUSTED_PROXY_HOPS = '1';
    const { buildApp } = await import('../app');
    const app = await buildApp();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      // The caller varies what they write; the load balancer always appends the same real address.
      const r = await app.inject({ method: 'GET', url: '/health', headers: { 'x-forwarded-for': `10.9.9.${i}, 198.51.100.7` } });
      statuses.push(r.statusCode);
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
    // Someone else, behind the same load balancer, isn't affected.
    const other = await app.inject({ method: 'GET', url: '/health', headers: { 'x-forwarded-for': '198.51.100.8' } });
    expect(other.statusCode).not.toBe(429);
    await app.close();
  });
});
