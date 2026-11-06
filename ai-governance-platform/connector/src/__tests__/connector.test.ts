import http from 'http';
import { AddressInfo } from 'net';
import { Connector, hostAllowed, makeCall } from '../connector';

describe('connector', () => {
  let api: http.Server;
  let apiUrl: string;
  const hits: Array<{ url: string; auth?: string }> = [];

  beforeAll(async () => {
    api = http.createServer((req, res) => {
      hits.push({ url: req.url!, auth: req.headers.authorization });
      if (req.url === '/redirect') { res.writeHead(302, { location: 'http://169.254.169.254/' }); return res.end(); }
      if (req.url === '/big') { res.writeHead(200); return res.end('x'.repeat(5000)); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
    await new Promise<void>((r) => api.listen(0, '127.0.0.1', () => r()));
    apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((r) => api.close(r)));
  beforeEach(() => { hits.length = 0; });

  const job = (path: string, extra: object = {}) => ({ id: 'a'.repeat(16), method: 'GET', url: `${apiUrl}${path}`, headers: { authorization: 'Bearer t' }, timeoutMs: 5000, maxBytes: 1000, ...extra });

  it('calls allowed hosts only, never metadata addresses or redirects, and caps answers', async () => {
    expect(await makeCall(job('/x'), ['127.0.0.1'])).toMatchObject({ status: 200, body: '{"ok":true,"path":"/x"}', truncated: false });
    expect(hits[0].auth).toBe('Bearer t');
    await expect(makeCall(job('/x'), ['hr.corp.example'])).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
    await expect(makeCall({ ...job('/'), url: 'http://169.254.169.254/latest/meta-data' }, ['169.254.169.254'])).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
    await expect(makeCall(job('/redirect'), ['127.0.0.1'])).rejects.toMatchObject({ code: 'BACKEND_REDIRECT' });
    expect(await makeCall(job('/big'), ['127.0.0.1'])).toMatchObject({ truncated: true, body: 'x'.repeat(1000) });
    await expect(makeCall({ ...job('/'), url: 'file:///etc/passwd' }, ['127.0.0.1'])).rejects.toMatchObject({ code: 'INVALID_URL' });
    expect(hostAllowed(['*.corp.example'], new URL('https://a.corp.example'))).toBe(true);
  });

  it('collects calls from the gateway, makes them, answers, and narrows hosts to the local list', async () => {
    const answers: any[] = [];
    let polls = 0;
    const gateway = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        expect(req.headers.authorization).toBe('Bearer pcn_t.con_1.s');
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/connector/v1/poll') {
          polls++;
          const jobs = polls === 1 ? [job('/one'), { ...job('/two'), id: 'b'.repeat(16), url: `${apiUrl.replace('127.0.0.1', 'localhost')}/two` }] : [];
          return res.end(JSON.stringify({ jobs, allowedHosts: ['127.0.0.1', 'localhost'] }));
        }
        answers.push(JSON.parse(body));
        res.end('{"accepted":true}');
      });
    });
    await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', () => r()));
    const c = new Connector({ gatewayUrl: `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`, token: 'pcn_t.con_1.s', localAllowedHosts: ['127.0.0.1'], log: () => undefined });
    const running = c.run();
    for (let i = 0; i < 100 && answers.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    c.stop();
    await running;
    await new Promise((r) => gateway.close(r));
    const byId = Object.fromEntries(answers.map((a) => [a.id, a]));
    expect(byId['a'.repeat(16)].answer).toMatchObject({ status: 200, body: '{"ok":true,"path":"/one"}' });
    // localhost is allowed by the gateway, but not by the local list.
    expect(byId['b'.repeat(16)].error).toMatchObject({ code: 'HOST_NOT_ALLOWED' });
    expect(hits.map((h) => h.url)).toEqual(['/one']);
  });

  it('stops when the gateway no longer accepts its token', async () => {
    const gateway = http.createServer((_req, res) => { res.writeHead(401); res.end('{}'); });
    await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', () => r()));
    const logs: string[] = [];
    await new Connector({ gatewayUrl: `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`, token: 'x', log: (_l, m) => logs.push(m) }).run();
    await new Promise((r) => gateway.close(r));
    expect(logs.join(' ')).toMatch(/doesn't accept this connector token/);
  });
});
