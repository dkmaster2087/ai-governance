import { generateKeyPairSync, createSign, randomBytes } from 'crypto';
import Fastify from 'fastify';
// The gateway's own signing code: tokens here are exactly what Probaline sends.
import { GatewayKeys, MemoryVault } from '../../../../services/gateway/src/mcp/keys';
import { createVerifier, expressGuard, fastifyGuard, HEADER, TOKEN_TYPE, VerifyError } from '..';
import { createAuthorizer } from '../lambda';

const ISS = 'https://gateway.acme.example';
const AUD = 'https://hr.acme.example/api';
const keys = new GatewayKeys(new MemoryVault(), 'test/keys');
let jwks: any;
let fetches = 0;
const fetchJwks = async () => { fetches++; return { ok: true, status: 200, json: async () => jwks }; };

const now = () => Math.floor(Date.now() / 1000);
const sign = (over: Record<string, unknown> = {}) => keys.sign({
  iss: ISS, aud: AUD, sub: 'person:jane@acme.example', iat: now(), exp: now() + 300, jti: randomBytes(8).toString('hex'),
  kind: 'person', email: 'jane@acme.example', tenant: 't1', server: 'srv1', tool: 'getEmployee', agent: 'claude', rid: 'req-1', ...over,
}, TOKEN_TYPE);

beforeAll(async () => { jwks = await keys.jwks(); });
beforeEach(() => { fetches = 0; });

const verifier = () => createVerifier({ issuer: ISS, audience: AUD, fetch: fetchJwks });
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as VerifyError).code; } };

describe('verifier', () => {
  it('accepts what the gateway signs, and returns who asked', async () => {
    const id = await verifier().verify(await sign());
    expect(id).toMatchObject({ sub: 'person:jane@acme.example', email: 'jane@acme.example', tool: 'getEmployee', rid: 'req-1', tenant: 't1' });
  });

  it('ignores a trailing slash on the issuer or audience', async () => {
    const v = createVerifier({ issuer: `${ISS}/`, audience: `${AUD}/`, fetch: fetchJwks });
    expect(await code(v.verify(await sign()))).toBe('ok');
  });

  it('refuses missing, malformed, expired, future, other-API and other-gateway tokens', async () => {
    const v = verifier();
    expect(await code(v.verify(undefined))).toBe('missing');
    expect(await code(v.verify('abc'))).toBe('malformed');
    expect(await code(v.verify(await sign({ exp: now() - 120 })))).toBe('expired');
    expect(await code(v.verify(await sign({ iat: now() + 600 })))).toBe('not_yet_valid');
    expect(await code(v.verify(await sign({ aud: 'https://payroll.acme.example' })))).toBe('wrong_audience');
    expect(await code(v.verify(await sign({ iss: 'https://evil.example' })))).toBe('wrong_issuer');
  });

  it('refuses tampered claims and tokens signed by anyone else', async () => {
    const v = verifier();
    const [h, c, s] = (await sign()).split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(c, 'base64url').toString()), sub: 'person:ceo@acme.example' })).toString('base64url');
    expect(await code(v.verify(`${h}.${forged}.${s}`))).toBe('bad_signature');

    // Someone else's ES256 key, claiming the gateway's key ID.
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: jwks.keys[0].kid, typ: TOKEN_TYPE })).toString('base64url');
    const sig = createSign('sha256').update(`${header}.${c}`).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    expect(await code(v.verify(`${header}.${c}.${sig}`))).toBe('bad_signature');

    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: TOKEN_TYPE })).toString('base64url');
    expect(await code(v.verify(`${none}.${c}.`))).toBe('wrong_type');
    const hs = Buffer.from(JSON.stringify({ alg: 'HS256', kid: jwks.keys[0].kid, typ: TOKEN_TYPE })).toString('base64url');
    expect(await code(v.verify(`${hs}.${c}.${s}`))).toBe('wrong_type');
    const otherKid = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'nope', typ: TOKEN_TYPE })).toString('base64url');
    expect(await code(v.verify(`${otherKid}.${c}.${s}`))).toBe('unknown_key');
  });

  it('caches the keys, and says so when they can’t be fetched', async () => {
    const v = verifier();
    for (let i = 0; i < 5; i++) await v.verify(await sign());
    expect(fetches).toBe(1);
    const down = createVerifier({ issuer: ISS, audience: AUD, fetch: async () => ({ ok: false, status: 502, json: async () => ({}) }) });
    expect(await code(down.verify(await sign()))).toBe('keys_unavailable');
  });
});

describe('Fastify and Express guards', () => {
  it('refuse unsigned calls with 401 and pass signed ones with the identity', async () => {
    const app = Fastify();
    app.addHook('onRequest', fastifyGuard({ issuer: ISS, audience: AUD, fetch: fetchJwks, onReject: () => {} }));
    app.get('/employees/:id', async (req: any) => ({ askedBy: req.probaline.sub }));
    expect((await app.inject({ method: 'GET', url: '/employees/1' })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'GET', url: '/employees/1', headers: { [HEADER]: await sign() } });
    expect(ok.json()).toEqual({ askedBy: 'person:jane@acme.example' });
    await app.close();
  });

  it('in report-only mode, let unsigned calls through and report them', async () => {
    const reported: string[] = [];
    const app = Fastify();
    app.addHook('onRequest', fastifyGuard({ issuer: ISS, audience: AUD, fetch: fetchJwks, reportOnly: true, onReject: (i) => reported.push(`${i.code} ${i.path}`) }));
    app.get('/salaries', async (req: any) => ({ identity: req.probaline }));
    const res = await app.inject({ method: 'GET', url: '/salaries' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ identity: null });
    expect(reported).toEqual(['missing /salaries']);
    await app.close();
  });

  it('work as Express middleware', async () => {
    const guard = expressGuard({ issuer: ISS, audience: AUD, fetch: fetchJwks, onReject: () => {} });
    const run = (headers: Record<string, string>) => new Promise<{ status?: number; body?: any; req: any }>((resolve) => {
      const req: any = { headers, method: 'GET', url: '/x' };
      const res: any = { status(s: number) { this.s = s; return this; }, set() { return this; }, json(b: any) { resolve({ status: this.s, body: b, req }); } };
      guard(req, res, () => resolve({ req }));
    });
    expect((await run({})).status).toBe(401);
    expect((await run({ [HEADER]: await sign() })).req.probaline.email).toBe('jane@acme.example');
  });
});

describe('API Gateway Lambda authorizer', () => {
  const auth = createAuthorizer({ issuer: ISS, audience: AUD, fetch: fetchJwks, onReject: () => {} });

  it('answers HTTP APIs with a simple response and the identity as context', async () => {
    expect(await auth({ version: '2.0', headers: {} })).toEqual({ isAuthorized: false, context: {} });
    const ok = await auth({ version: '2.0', headers: { 'X-Probaline-Identity': await sign() } });
    expect(ok).toMatchObject({ isAuthorized: true, context: { probalineSub: 'person:jane@acme.example', probalineRequestId: 'req-1' } });
  });

  it('answers REST APIs with an IAM policy', async () => {
    const arn = 'arn:aws:execute-api:eu-west-1:111122223333:abc123/prod/GET/employees';
    const denied: any = await auth({ type: 'REQUEST', methodArn: arn, headers: {} });
    expect(denied.policyDocument.Statement[0]).toEqual({ Action: 'execute-api:Invoke', Effect: 'Deny', Resource: arn });
    const allowed: any = await auth({ type: 'REQUEST', methodArn: arn, headers: { 'x-probaline-identity': await sign() } });
    expect(allowed.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(allowed.principalId).toBe('person:jane@acme.example');
  });

  it('lets calls through in report-only mode', async () => {
    const preview = createAuthorizer({ issuer: ISS, audience: AUD, fetch: fetchJwks, reportOnly: true, onReject: () => {} });
    expect(await preview({ version: '2.0', headers: {} })).toEqual({ isAuthorized: true, context: { probalineSub: '', probalineReportOnly: 'true' } });
  });
});
