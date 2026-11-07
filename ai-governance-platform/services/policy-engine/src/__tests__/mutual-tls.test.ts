import { execFileSync } from 'child_process';
import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import { MemoryStore, setRecords } from '@ai-governance/storage';
import { INTERNAL_HEADER, internalHttpsAgent, newInternalKey, signingKeyFrom, signInternal, trustedKeysFrom } from '@ai-governance/utils';
import { buildApp } from '../app';

/** The policy engine served over mutual TLS, with certificates made the way an install makes them. */
describe('mutual TLS between services', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pki-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'pki-other-'));
  const read = (d: string, n: string) => fs.readFileSync(path.join(d, n), 'utf8');
  const tlsOf = (d: string, name: string) => ({ ca: read(d, 'ca.pem'), cert: read(d, `${name}.pem`), key: read(d, `${name}.key`) });
  const GW = newInternalKey('gateway');
  const AGENT = newInternalKey('reporting-agent');
  let app: Awaited<ReturnType<typeof buildApp>>;
  let port = 0;

  beforeAll(async () => {
    const script = path.resolve(__dirname, '../../../../scripts/internal-pki.mjs');
    execFileSync('node', [script, 'local', dir]);
    execFileSync('node', [script, 'local', other]);
    setRecords(new MemoryStore());
    app = await buildApp({ trusted: () => trustedKeysFrom([GW.trusted, AGENT.trusted]), tls: tlsOf(dir, 'policy-engine') });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as { port: number }).port;
  }, 30_000);
  afterAll(async () => { await app.close(); fs.rmSync(dir, { recursive: true }); fs.rmSync(other, { recursive: true }); });

  const call = (url: string, opts: { as?: string; certsFrom?: string; token?: string; servername?: string } = {}) =>
    new Promise<number>((resolve, reject) => {
      const agent = opts.as ? internalHttpsAgent({ ...tlsOf(opts.certsFrom ?? dir, opts.as), ca: read(dir, 'ca.pem') }) : new https.Agent({ ca: read(dir, 'ca.pem') });
      const req = https.request({ host: '127.0.0.1', port, path: url, agent, servername: opts.servername ?? 'localhost', headers: opts.token ? { [INTERNAL_HEADER]: opts.token } : {} },
        (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.end();
    });
  const gatewayToken = () => signInternal({ tenantId: 'tenant_a', userId: 'u', role: 'gateway' }, signingKeyFrom(GW.signing), 'policy-engine');

  it('answers the gateway, with its certificate and token', async () => {
    expect(await call('/v1/policies/tenant_a', { as: 'gateway', token: gatewayToken() })).toBe(200);
  });

  it('refuses callers without a service certificate, or with another install\'s, or the wrong service', async () => {
    expect(await call('/v1/policies/tenant_a', { token: gatewayToken() })).toBe(401);
    // A 'gateway' certificate from another install's CA isn't this install's gateway.
    expect(await call('/v1/policies/tenant_a', { as: 'gateway', certsFrom: other, token: gatewayToken() })).toBe(401);
    expect(await call('/v1/policies/tenant_a', { as: 'analytics', token: gatewayToken() })).toBe(401);
  });

  it('lets a reporting agent\'s certificate carry only its own token', async () => {
    const agentToken = signInternal({ tenantId: 'tenant_a', userId: 'reporting-agent', role: 'reporting_agent' }, signingKeyFrom(AGENT.signing), 'policy-engine');
    expect(await call('/v1/compliance/status/tenant_a', { as: 'reporting-agent', token: agentToken })).toBe(200);
    expect(await call('/v1/policies/tenant_a', { as: 'reporting-agent', token: gatewayToken() })).toBe(403);
  });

  it('keeps health checks open, and the gateway checks it reached the right service', async () => {
    expect(await call('/health')).toBe(200);
    await expect(call('/health', { servername: 'analytics' })).rejects.toThrow();
  });
});
