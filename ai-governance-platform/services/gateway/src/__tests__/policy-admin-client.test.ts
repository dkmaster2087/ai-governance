import http from 'http';
import { AddressInfo } from 'net';
import { PolicyAdminClient } from '../clients/policy-admin.client';

describe('policy engine client', () => {
  it('sends compliance actions with a JSON body, which the engine requires, and names refusals as refusals', async () => {
    const seen: Array<{ url: string; type?: string; body: string }> = [];
    const engine = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({ url: req.url!, type: req.headers['content-type'], body });
        const json = (req.headers['content-type'] ?? '').startsWith('application/json');
        res.writeHead(req.url!.includes('/broken') ? 415 : json ? 200 : 415, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((r) => engine.listen(0, '127.0.0.1', () => r()));
    const client = new PolicyAdminClient();
    (client as unknown as { baseUrl: string }).baseUrl = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;
    await expect(client.compliance('post', '/sync/t1/hipaa')).resolves.toEqual({ ok: true });
    await expect(client.compliance('post', '/assess/t1/hipaa')).resolves.toEqual({ ok: true });
    expect(seen.map((s) => [s.type, s.body])).toEqual([['application/json', '{}'], ['application/json', '{}']]);
    await expect(client.compliance('post', '/broken')).rejects.toMatchObject({ code: 'POLICY_ENGINE_REFUSED' });
    await new Promise((r) => engine.close(r));
  });
});
