import http from 'http';
import path from 'path';
import { execFile, spawnSync } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { GatewayKeys, MemoryVault } from '../../../../services/gateway/src/mcp/keys';
import { TOKEN_TYPE } from '..';

// The Python verifier, against tokens the gateway's own key code signs. Skipped where python3 or PyJWT is missing.
const hasPython = spawnSync('python3', ['-c', 'import jwt, cryptography']).status === 0;
const maybe = hasPython ? describe : describe.skip;

maybe('Python verifier (snippets/python)', () => {
  const ISS = 'https://gateway.acme.example';
  const AUD = 'https://hr.acme.example/api';
  const keys = new GatewayKeys(new MemoryVault(), 'test/py');
  let server: http.Server;
  let jwksUrl = '';
  const now = () => Math.floor(Date.now() / 1000);
  const sign = (over: Record<string, unknown> = {}) => keys.sign({ iss: ISS, aud: AUD, sub: 'person:jane@acme.example', iat: now(), exp: now() + 300, jti: randomBytes(4).toString('hex'), kind: 'person', tenant: 't', server: 's', tool: 'x', rid: 'r', ...over }, TOKEN_TYPE);
  // Async: the JWKS server runs in this process, so a blocking call would wait on itself.
  const run = async (token: string, audience = AUD) => JSON.parse((await promisify(execFile)('python3', ['-I', path.join(__dirname, '../../snippets/python/probaline_identity.py'), ISS, audience, jwksUrl, token], { encoding: 'utf8' })).stdout);

  beforeAll(async () => {
    const body = JSON.stringify(await keys.jwks());
    server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(body); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    jwksUrl = `http://127.0.0.1:${(server.address() as any).port}/.well-known/jwks.json`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('accepts a gateway-signed token, ignoring a trailing slash', async () => {
    expect(await run(await sign(), `${AUD}/`)).toEqual({ ok: true, sub: 'person:jane@acme.example' });
  });

  it('refuses missing, expired, other-API and tampered tokens', async () => {
    expect(await run('')).toEqual({ ok: false, code: 'missing' });
    expect(await run(await sign({ exp: now() - 120, iat: now() - 420 }))).toEqual({ ok: false, code: 'expired' });
    expect(await run(await sign({ aud: 'https://payroll.acme.example' }))).toEqual({ ok: false, code: 'wrong_audience' });
    const [h, c, s] = (await sign()).split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(c, 'base64url').toString()), sub: 'person:ceo' })).toString('base64url');
    expect(await run(`${h}.${forged}.${s}`)).toEqual({ ok: false, code: 'bad_signature' });
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: TOKEN_TYPE })).toString('base64url');
    expect(await run(`${none}.${c}.`)).toEqual({ ok: false, code: 'wrong_type' });
  });
});
