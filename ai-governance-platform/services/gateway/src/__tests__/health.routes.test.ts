import { buildApp } from '../app';

describe('Health Routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns healthy status', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('healthy');
    expect(body.service).toBe('gateway');
  });

  it('GET /health/ready returns status with dependencies', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    // In test env without real dependencies, status will be 'degraded'
    expect(['ready', 'degraded']).toContain(body.status);
    expect(body.dependencies).toBeDefined();
    expect(Array.isArray(body.dependencies)).toBe(true);
  });

  it('lets only known websites and the browser extension call from a browser', async () => {
    const from = async (origin: string) =>
      (await app.inject({ method: 'GET', url: '/health', headers: { origin } })).headers['access-control-allow-origin'];
    expect(await from('https://evil.example')).toBeUndefined();
    expect(await from('chrome-extension://abc')).toBe('chrome-extension://abc');
    expect(await from('http://localhost:5174')).toBe('http://localhost:5174');
  });
});
