import http from 'http';
import { AddressInfo } from 'net';
import { INTERNAL_HEADER, newInternalKey, trustedKeysFrom, verifyInternal } from '@ai-governance/utils';
import { PolicyAdminClient } from '../clients/policy-admin.client';

const PAIR = newInternalKey('gateway');

describe('policy engine client', () => {
  it('sends compliance actions with a JSON body, which the engine requires, and names refusals as refusals', async () => {
    process.env.INTERNAL_SIGNING_KEY = JSON.stringify(PAIR.signing);
    const seen: Array<{ url: string; type?: string; body: string; token?: string }> = [];
    const engine = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({ url: req.url!, type: req.headers['content-type'], body, token: req.headers[INTERNAL_HEADER] as string });
        const json = (req.headers['content-type'] ?? '').startsWith('application/json');
        res.writeHead(req.url!.includes('/broken') ? 415 : json ? 200 : 415, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((r) => engine.listen(0, '127.0.0.1', () => r()));
    const client = new PolicyAdminClient();
    (client as unknown as { baseUrl: string }).baseUrl = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;
    await expect(client.compliance('t1', 'post', '/sync/t1/hipaa')).resolves.toEqual({ ok: true });
    await expect(client.compliance('t1', 'post', '/assess/t1/hipaa')).resolves.toEqual({ ok: true });
    expect(seen.map((s) => [s.type, s.body])).toEqual([['application/json', '{}'], ['application/json', '{}']]);
    expect(verifyInternal(seen[0].token!, trustedKeysFrom([PAIR.trusted]), 'policy-engine')).toMatchObject({ tenantId: 't1', role: 'gateway' });
    await expect(client.compliance('t1', 'post', '/broken')).rejects.toMatchObject({ code: 'POLICY_ENGINE_REFUSED' });
    await new Promise((r) => engine.close(r));
    delete process.env.INTERNAL_SIGNING_KEY;
  });
});
