import http from 'http';
import { AddressInfo } from 'net';
import { createHash, generateKeyPairSync, KeyObject, randomBytes } from 'crypto';
import Fastify, { FastifyInstance } from 'fastify';
import { MemoryStore, setRecords } from '@ai-governance/storage';
import { ToolCaller } from '../mcp/calls';
import { ApprovalService, fingerprint } from '../mcp/approvals';
import { ConnectorService, hostAllowed } from '../mcp/connectors';
import { GatewayKeys, MemoryVault, setGatewayKeys } from '../mcp/keys';
import { keyFromJwk, signJwt, verifyJwt } from '../mcp/jwt';
import { OidcClient } from '../mcp/oidc';
import { redirectProblem } from '../routes/mcp-oauth.routes';

const SPEC = `
openapi: 3.0.3
info: { title: People API, version: "1.2" }
paths:
  /employees:
    get: { operationId: listEmployees, parameters: [{ name: dept, in: query, schema: { type: string } }] }
    post:
      operationId: createEmployee
      requestBody: { required: true, content: { application/json: { schema: { type: object, required: [name], properties: { name: { type: string } } } } } }
  /employees/{id}:
    get: { operationId: getEmployee, parameters: [{ name: id, in: path, required: true, schema: { type: string } }] }
  /salaries: { get: { operationId: listSalaries } }
`;
const GW = 'https://gw.acme.example';
const T = 'tenant_acme';

describe('tokens', () => {
  it('signs and checks ES256 and RS256, and refuses tampering, other issuers and audiences, expiry and alg tricks', async () => {
    const keys = new GatewayKeys(new MemoryVault());
    const t = Math.floor(Date.now() / 1000);
    const token = await keys.sign({ iss: 'https://i', aud: 'https://a', sub: 'x', exp: t + 60 }, 'at+jwt');
    const key = (h: { kid?: string }) => keys.publicKey(h.kid);
    await expect(verifyJwt(token, { issuer: 'https://i', audience: 'https://a', typ: 'at+jwt', key })).resolves.toMatchObject({ sub: 'x' });
    await expect(verifyJwt(token, { issuer: 'https://other', audience: 'https://a', key })).rejects.toThrow(/issuer/);
    await expect(verifyJwt(token, { issuer: 'https://i', audience: 'https://b', key })).rejects.toThrow(/audience/);
    await expect(verifyJwt(token, { issuer: 'https://i', audience: 'https://a', typ: 'other', key })).rejects.toThrow(/type/);
    const [h, p, s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ iss: 'https://i', aud: 'https://a', sub: 'admin', exp: t + 60 })).toString('base64url');
    await expect(verifyJwt(`${h}.${forged}.${s}`, { issuer: 'https://i', audience: 'https://a', key })).rejects.toThrow(/signature/);
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${p}.`;
    await expect(verifyJwt(none, { issuer: 'https://i', audience: 'https://a', key })).rejects.toThrow(/not accepted/);
    const hs = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${p}.${s}`;
    await expect(verifyJwt(hs, { issuer: 'https://i', audience: 'https://a', key })).rejects.toThrow(/not accepted/);
    const old = await keys.sign({ iss: 'https://i', aud: 'https://a', exp: t - 120 }, 'at+jwt');
    await expect(verifyJwt(old, { issuer: 'https://i', audience: 'https://a', key })).rejects.toThrow(/expired/);

    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rs = signJwt({ alg: 'RS256', kid: 'r1' }, { iss: 'https://idp', aud: ['c1', 'c2'], exp: t + 60 }, privateKey);
    await expect(verifyJwt(rs, { issuer: 'https://idp', audience: 'c2', key: () => keyFromJwk(publicKey.export({ format: 'jwk' })) })).resolves.toBeTruthy();
    // An RSA key can't check an EC-signed token (and the other way round).
    await expect(verifyJwt(token, { issuer: 'https://i', audience: 'https://a', key: () => publicKey })).rejects.toThrow(/does not match/);
  });

  it('encrypts what it keeps, with the same key on every instance', async () => {
    const vault = new MemoryVault();
    const a = new GatewayKeys(vault);
    const b = new GatewayKeys(vault);
    const sealed = await a.encrypt('idp-refresh-token');
    expect(sealed).not.toContain('idp-refresh');
    expect(await b.decrypt(sealed)).toBe('idp-refresh-token');
    expect(await a.jwks()).toEqual(await b.jwks());
  });
});

describe('small rules', () => {
  it('accepts redirect addresses agents use, and nothing dangerous', () => {
    for (const ok of ['https://claude.ai/api/mcp/auth_callback', 'http://localhost:6274/callback', 'http://127.0.0.1:33418/cb', 'cursor://anysphere.cursor-retrieval/oauth/callback', 'vscode://vscode.github-authentication/did-authenticate']) expect(redirectProblem(ok)).toBeNull();
    for (const bad of ['http://evil.example/cb', 'javascript:alert(1)', 'data:text/html,hi', 'https://x.example/cb#frag', 'not a url']) expect(redirectProblem(bad)).not.toBeNull();
  });
  it('matches connector hosts exactly, by port, or by wildcard', () => {
    const c = { allowedHosts: ['hr.corp.example', 'pay.corp.example:8443', '*.svc.corp.example'] };
    expect(hostAllowed(c, new URL('https://hr.corp.example/x'))).toBe(true);
    expect(hostAllowed(c, new URL('https://pay.corp.example:8443/x'))).toBe(true);
    expect(hostAllowed(c, new URL('https://pay.corp.example/x'))).toBe(false);
    expect(hostAllowed(c, new URL('http://a.svc.corp.example:8080/x'))).toBe(true);
    expect(hostAllowed(c, new URL('https://svc.corp.example/x'))).toBe(false);
    expect(hostAllowed(c, new URL('https://hr.corp.example.evil.example/x'))).toBe(false);
  });
  it('fingerprints the same call the same way, whatever the key order', () => {
    expect(fingerprint(T, 's', 't', 'k', { a: 1, b: { c: 2, d: 3 } })).toBe(fingerprint(T, 's', 't', 'k', { b: { d: 3, c: 2 }, a: 1 }));
    expect(fingerprint(T, 's', 't', 'k', { a: 1 })).not.toBe(fingerprint(T, 's', 't', 'other-key', { a: 1 }));
  });
});

// ── Everything together: a company API, a stand-in identity provider, and the real routes ──────────────

describe('MCP phase 2', () => {
  let backend: http.Server;
  let base: string;
  let idp: http.Server;
  let idpBase: string;
  const seen: Array<{ method: string; url: string; identity?: string; body?: string }> = [];
  const idpKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const idpCodes = new Map<string, { sub: string; email: string; groups: string[]; nonce: string }>();
  const idpRefresh = new Map<string, { sub: string; email: string; groups: string[]; disabled?: boolean }>();
  const audit = { log: jest.fn(async () => undefined) };
  const policy = { evaluate: jest.fn(async () => ({ allowed: true, action: 'allow', triggeredRules: [], riskScore: 0 })) };
  const protection = { filterResponse: jest.fn(async (r: any) => r) };
  const credentials = { save: jest.fn(async (_t: string, id: string) => `arn:secret:${id}`), get: jest.fn(async (arn: string) => (arn.includes(':signin-') ? 'idp-secret' : 'backend-token-123')), remove: jest.fn(async () => undefined) };
  const keys = new GatewayKeys(new MemoryVault());
  const connectors = new ConnectorService(20);

  const idToken = (p: { sub: string; email: string; groups: string[] }, nonce?: string) => signJwt({ alg: 'RS256', kid: 'idp-1' },
    { iss: idpBase, aud: 'probaline-client', sub: p.sub, email: p.email, groups: p.groups, ...(nonce ? { nonce } : {}), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 }, idpKey.privateKey as KeyObject);

  beforeAll(async () => {
    process.env.MCP_ALLOW_PRIVATE_BACKENDS = 'true';
    process.env.MCP_ALLOW_HTTP_BACKENDS = 'true';
    process.env.PUBLIC_GATEWAY_URL = GW;
    setGatewayKeys(keys);
    backend = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({ method: req.method!, url: req.url!, identity: req.headers['x-probaline-identity'] as string, body });
        res.writeHead(req.method === 'POST' ? 201 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(req.method === 'POST' ? { id: 'e2', ...JSON.parse(body || '{}') } : req.url === '/salaries' ? [{ id: 'e1', salary: 1 }] : { id: 'e1', name: 'Jane' }));
      });
    });
    idp = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const send = (status: number, v: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
        if (req.url === '/.well-known/openid-configuration') return send(200, { issuer: idpBase, authorization_endpoint: `${idpBase}/authorize`, token_endpoint: `${idpBase}/token`, jwks_uri: `${idpBase}/jwks` });
        if (req.url === '/jwks') return send(200, { keys: [{ ...idpKey.publicKey.export({ format: 'jwk' }), kid: 'idp-1', use: 'sig', alg: 'RS256' }] });
        if (req.url === '/token') {
          if (req.headers.authorization !== `Basic ${Buffer.from('probaline-client:idp-secret').toString('base64')}`) return send(401, { error: 'invalid_client' });
          const f = Object.fromEntries(new URLSearchParams(body));
          if (f.grant_type === 'authorization_code') {
            const c = idpCodes.get(f.code);
            if (!c || f.redirect_uri !== `${GW}/oauth/callback` || !f.code_verifier) return send(400, { error: 'invalid_grant' });
            const rt = randomBytes(8).toString('hex');
            idpRefresh.set(rt, c);
            return send(200, { id_token: idToken(c, c.nonce), refresh_token: rt, access_token: 'x' });
          }
          const r = idpRefresh.get(f.refresh_token);
          if (!r || r.disabled) return send(400, { error: 'invalid_grant', error_description: 'User is disabled' });
          return send(200, { id_token: idToken(r), access_token: 'x' });
        }
        send(404, {});
      });
    });
    await new Promise<void>((r) => backend.listen(0, '127.0.0.1', () => r()));
    await new Promise<void>((r) => idp.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
    idpBase = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    delete process.env.MCP_ALLOW_PRIVATE_BACKENDS; delete process.env.MCP_ALLOW_HTTP_BACKENDS; delete process.env.PUBLIC_GATEWAY_URL;
    setGatewayKeys(null);
    await new Promise((r) => backend.close(r));
    await new Promise((r) => idp.close(r));
  });
  beforeEach(() => { setRecords(new MemoryStore()); seen.length = 0; jest.clearAllMocks(); });

  type Who = { anonymous?: boolean; role?: string; userId?: string; email?: string; key?: { keyId: string; scopes: string[] } };
  async function appAs(who: Who = {}): Promise<FastifyInstance> {
    const { mcpRoutes } = await import('../routes/mcp.routes');
    const { mcpOauthRoutes } = await import('../routes/mcp-oauth.routes');
    const { mcpApprovalRoutes } = await import('../routes/mcp-approvals.routes');
    const { mcpConnectorRoutes } = await import('../routes/mcp-connectors.routes');
    const app = Fastify();
    app.decorateRequest('principal', null);
    app.addHook('preHandler', async (req: any) => {
      if (who.anonymous) return;
      if (who.key) {
        req.principal = { kind: 'api_key', tenantId: T, keyId: who.key.keyId, scopes: who.key.scopes, userId: 'agent-user', appId: 'support-agent' };
      } else {
        req.principal = { kind: 'user', homeTenantId: T, userId: who.userId ?? 'admin1', email: who.email, role: who.role ?? 'tenant_admin' };
      }
      req.tenantId = T;
      req.userId = req.principal.userId;
    });
    const caller = new ToolCaller(policy as any, protection as any, audit as any, credentials as any, undefined, new ApprovalService(20), connectors, keys);
    await app.register(mcpRoutes, { caller, credentials: credentials as any, connectors });
    await app.register(mcpOauthRoutes, { oidc: new OidcClient(), credentials: credentials as any, keys });
    await app.register(mcpApprovalRoutes, { approvals: new ApprovalService(20) });
    await app.register(mcpConnectorRoutes, { connectors, waitMs: 300 });
    return app;
  }

  async function setUp(admin: FastifyInstance, extra: object = {}) {
    await admin.inject({ method: 'POST', url: '/v1/mcp/servers', payload: { name: 'HR self-service' } });
    const added = await admin.inject({ method: 'POST', url: '/v1/mcp/servers/hr-self-service/apis', payload: { name: 'People API', baseUrl: base, openapi: SPEC, auth: { type: 'bearer', secret: 'backend-token-123' }, ...extra } });
    expect(added.statusCode).toBe(201);
  }
  const publish = async (admin: FastifyInstance, note = '') => (await admin.inject({ method: 'POST', url: '/v1/mcp/servers/hr-self-service/publish', payload: { note } })).json();
  const patch = (admin: FastifyInstance, payload: object) => admin.inject({ method: 'PATCH', url: '/v1/mcp/servers/hr-self-service', payload });
  const tool = (admin: FastifyInstance, name: string, payload: object) => admin.inject({ method: 'PATCH', url: `/v1/mcp/servers/hr-self-service/tools/${name}`, payload });
  const rpc = (app: FastifyInstance, method: string, params?: object, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: `/mcp/${T}/hr-self-service`, headers, payload: { jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) } });
  const call = async (app: FastifyInstance, name: string, args: object = {}, headers: Record<string, string> = {}) =>
    (await rpc(app, 'tools/call', { name, arguments: args }, headers)).json().result;
  const agent = (keyId = 'key_agent') => appAs({ key: { keyId, scopes: ['mcp'] } });

  // ── Versions ────────────────────────────────────────────────────────────────────────────────

  it('keeps edits in a draft until they are published, and can restore an earlier version', async () => {
    const admin = await appAs();
    await setUp(admin);
    expect(await publish(admin, 'First')).toMatchObject({ version: 1, hasChanges: false, status: 'published' });
    const a = await agent();
    const names = async () => (await rpc(a, 'tools/list')).json().result.tools.map((t: any) => t.name).sort();
    expect(await names()).toEqual(['getEmployee', 'listEmployees', 'listSalaries']);

    await tool(admin, 'listSalaries', { enabled: false });
    expect((await admin.inject({ method: 'GET', url: '/v1/mcp/servers/hr-self-service' })).json()).toMatchObject({ hasChanges: true, publishedVersion: 1 });
    expect(await names()).toContain('listSalaries'); // agents still see version 1
    expect(await publish(admin, 'No salaries')).toMatchObject({ version: 2, hasChanges: false });
    expect(await names()).toEqual(['getEmployee', 'listEmployees']);

    const versions = (await admin.inject({ method: 'GET', url: '/v1/mcp/servers/hr-self-service/versions' })).json();
    expect(versions.map((v: any) => [v.version, v.note, v.live])).toEqual([[2, 'No salaries', true], [1, 'First', false]]);
    expect((await admin.inject({ method: 'POST', url: '/v1/mcp/servers/hr-self-service/versions/1/restore' })).json()).toEqual({ ok: true, restored: 1 });
    expect(await names()).toEqual(['getEmployee', 'listEmployees']); // restoring changes the draft only
    expect(await publish(admin)).toMatchObject({ version: 3 });
    expect(await names()).toContain('listSalaries');

    // Pause and resume keep the version.
    await admin.inject({ method: 'POST', url: '/v1/mcp/servers/hr-self-service/pause', payload: {} });
    expect((await rpc(a, 'tools/list')).statusCode).toBe(503);
    expect((await admin.inject({ method: 'POST', url: '/v1/mcp/servers/hr-self-service/resume', payload: {} })).json()).toMatchObject({ status: 'published', publishedVersion: 3 });
    expect((await rpc(a, 'tools/list')).statusCode).toBe(200);
  });

  it('keeps an API\'s credential while a published version uses it, and removes all of them with the server', async () => {
    const admin = await appAs();
    await setUp(admin);
    await publish(admin);
    const apiId = (await admin.inject({ method: 'GET', url: '/v1/mcp/servers/hr-self-service' })).json().apis[0].apiId;
    await admin.inject({ method: 'DELETE', url: `/v1/mcp/servers/hr-self-service/apis/${apiId}` });
    expect(credentials.remove).not.toHaveBeenCalled();
    expect((await call(await agent(), 'getEmployee', { id: 'e1' })).isError).toBe(false); // version 1 still works
    await admin.inject({ method: 'DELETE', url: '/v1/mcp/servers/hr-self-service' });
    expect(credentials.remove).toHaveBeenCalledWith(`arn:secret:${apiId}`);
  });

  // ── Write tools and approvals ───────────────────────────────────────────────────────────────

  it('runs a write only after a person approves it, once, and tells the API who asked, signed', async () => {
    const admin = await appAs();
    await setUp(admin);
    expect((await tool(admin, 'createEmployee', { enabled: true })).json()).toMatchObject({ enabled: true, approval: 'required' });
    await patch(admin, { approvals: { approvers: [], waitSeconds: 0, expiresMinutes: 60 } });
    await publish(admin);
    const a = await agent();
    const listed = (await rpc(a, 'tools/list')).json().result.tools.find((t: any) => t.name === 'createEmployee');
    expect(listed.annotations.readOnlyHint).toBe(false);
    expect(listed.description).toMatch(/A person must approve each call/);

    const first = await call(a, 'createEmployee', { body: { name: 'Sam' } });
    expect(first.isError).toBe(true);
    expect(first.content[0].text).toMatch(/needs approval before it runs, and it hasn't run.*call createEmployee again with exactly the same arguments/);
    expect(seen).toEqual([]);
    // Asking again before a decision doesn't make a second request.
    await call(a, 'createEmployee', { body: { name: 'Sam' } });
    const queue = (await admin.inject({ method: 'GET', url: '/v1/mcp/approvals' })).json();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ status: 'pending', tool: 'createEmployee', method: 'POST', arguments: '{"body":{"name":"Sam"}}', caller: { kind: 'api_key', label: 'support-agent (API key)' }, canDecide: true });

    const approved = await admin.inject({ method: 'POST', url: `/v1/mcp/approvals/${queue[0].approvalId}/approve`, payload: {} });
    expect(approved.json()).toMatchObject({ status: 'approved', decidedBy: 'admin1' });
    expect((await admin.inject({ method: 'POST', url: `/v1/mcp/approvals/${queue[0].approvalId}/refuse`, payload: {} })).statusCode).toBe(409);

    // Different arguments are a different request.
    expect((await call(a, 'createEmployee', { body: { name: 'Someone else' } })).content[0].text).toMatch(/needs approval/);
    const done = await call(a, 'createEmployee', { body: { name: 'Sam' } });
    expect(done.isError).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/employees', body: '{"name":"Sam"}' });
    // Used once: the same call needs a new approval.
    expect((await call(a, 'createEmployee', { body: { name: 'Sam' } })).content[0].text).toMatch(/needs approval/);
    expect(seen).toHaveLength(1);
    const [req] = audit.log.mock.calls.find((c: any) => c[0].metadata.approvalId)! as any[];
    expect(req.metadata).toMatchObject({ write: 'true', approvalBy: 'admin1' });

    // The API can check who asked with Probaline's published key.
    const jwks = (await admin.inject({ method: 'GET', url: '/.well-known/jwks.json' })).json();
    const claims = await verifyJwt(seen[0].identity!, { issuer: GW, audience: base, typ: 'probaline-identity+jwt', key: () => keyFromJwk(jwks.keys[0]) });
    expect(claims).toMatchObject({ sub: 'key:key_agent', kind: 'api_key', tenant: T, server: 'hr-self-service', tool: 'createEmployee' });
  });

  it('waits for a decision while the agent is still connected, and stops refused calls', async () => {
    const admin = await appAs();
    await setUp(admin);
    await tool(admin, 'createEmployee', { enabled: true });
    await patch(admin, { approvals: { approvers: [], waitSeconds: 5, expiresMinutes: 60 } });
    await publish(admin);
    const a = await agent();

    const waiting = call(a, 'createEmployee', { body: { name: 'Ann' } });
    let id: string | undefined;
    for (let i = 0; i < 100 && !id; i++) { await new Promise((r) => setTimeout(r, 20)); id = (await admin.inject({ method: 'GET', url: '/v1/mcp/approvals' })).json()[0]?.approvalId; }
    await admin.inject({ method: 'POST', url: `/v1/mcp/approvals/${id}/approve`, payload: {} });
    expect((await waiting).isError).toBe(false);
    expect(seen.map((s) => s.body)).toEqual(['{"name":"Ann"}']);

    const refusedCall = call(a, 'createEmployee', { body: { name: 'Bob' } });
    id = undefined;
    for (let i = 0; i < 100 && !id; i++) { await new Promise((r) => setTimeout(r, 20)); id = (await admin.inject({ method: 'GET', url: '/v1/mcp/approvals' })).json().find((x: any) => x.status === 'pending')?.approvalId; }
    await admin.inject({ method: 'POST', url: `/v1/mcp/approvals/${id}/refuse`, payload: { reason: 'Not this quarter' } });
    const refused = await refusedCall;
    expect(refused.content[0].text).toMatch(/^Stopped by Probaline: refused by admin1 \(“Not this quarter”\)/);
    expect(seen).toHaveLength(1);
  });

  it('lets only the named approvers decide, never on their own request; writes can also run without approval', async () => {
    const admin = await appAs({ email: 'it@acme.example' });
    await setUp(admin);
    await tool(admin, 'createEmployee', { enabled: true });
    await patch(admin, { approvals: { approvers: ['Boss@Acme.example'], waitSeconds: 0, expiresMinutes: 60 } });

    // The test console makes a request like an agent does (as the admin).
    const test = (await admin.inject({ method: 'POST', url: '/v1/mcp/servers/hr-self-service/test', payload: { tool: 'createEmployee', arguments: { body: { name: 'Zoe' } } } })).json();
    expect(test).toMatchObject({ outcome: 'pending_approval', checks: expect.arrayContaining(['approval: waiting']) });
    expect((await admin.inject({ method: 'POST', url: `/v1/mcp/approvals/${test.approvalId}/approve`, payload: {} })).json().code).toBe('NOT_AN_APPROVER');
    const boss = await appAs({ userId: 'u-boss', email: 'boss@acme.example', role: 'tenant_user' });
    expect((await boss.inject({ method: 'GET', url: '/v1/mcp/approvals' })).json()[0]).toMatchObject({ canDecide: true, caller: { kind: 'test', email: 'it@acme.example' } });
    // An approver can't decide a request they made themselves.
    const bossTest = await appAs({ userId: 'u-boss', email: 'boss@acme.example' });
    const own = (await bossTest.inject({ method: 'POST', url: '/v1/mcp/servers/hr-self-service/test', payload: { tool: 'createEmployee', arguments: { body: { name: 'Own' } } } })).json();
    expect((await boss.inject({ method: 'POST', url: `/v1/mcp/approvals/${own.approvalId}/approve`, payload: {} })).json().code).toBe('OWN_REQUEST');
    expect((await boss.inject({ method: 'POST', url: `/v1/mcp/approvals/${test.approvalId}/approve`, payload: {} })).statusCode).toBe(200);
    expect((await admin.inject({ method: 'POST', url: '/v1/mcp/servers/hr-self-service/test', payload: { tool: 'createEmployee', arguments: { body: { name: 'Zoe' } } } })).json()).toMatchObject({ outcome: 'delivered' });

    await tool(admin, 'createEmployee', { approval: 'none' });
    expect((await admin.inject({ method: 'POST', url: '/v1/mcp/servers/hr-self-service/test', payload: { tool: 'createEmployee', arguments: { body: { name: 'Quick' } } } })).json()).toMatchObject({ outcome: 'delivered' });
    expect((await tool(admin, 'getEmployee', { approval: 'none' })).statusCode).toBe(400);
  });

  // ── People signing in through the identity provider ─────────────────────────────────────────

  async function configureSignIn(admin: FastifyInstance) {
    const r = await admin.inject({ method: 'PUT', url: '/v1/mcp/sign-in', payload: { issuer: idpBase, clientId: 'probaline-client', clientSecret: 'idp-secret', groupsClaim: 'groups', sessionHours: 8 } });
    expect(r.json()).toMatchObject({ configured: true, callbackUrl: `${GW}/oauth/callback`, secretHint: '…cret' });
    expect(JSON.stringify(r.json())).not.toContain('idp-secret');
    expect((await admin.inject({ method: 'POST', url: '/v1/mcp/sign-in/check', payload: {} })).json()).toMatchObject({ ok: true });
  }

  it('stores each new client secret under its own name and removes the old one (a deleted name stays reserved for a while)', async () => {
    const admin = await appAs();
    await configureSignIn(admin);
    const first = (credentials.save.mock.calls.at(-1) as any[])[1];
    await configureSignIn(admin);
    const second = (credentials.save.mock.calls.at(-1) as any[])[1];
    expect(first).toMatch(/^signin-/);
    expect(second).not.toBe(first);
    expect(credentials.remove).toHaveBeenCalledWith(`arn:secret:${first}`);
    await admin.inject({ method: 'PUT', url: '/v1/mcp/sign-in', payload: { issuer: idpBase, clientId: 'probaline-client', groupsClaim: 'groups' } });
    expect(credentials.save).toHaveBeenCalledTimes(2); // no secret given: the saved one is kept
  });

  /** What an MCP client does: discover, register, send the person to sign in, exchange the code. */
  async function signIn(person: { sub: string; email: string; groups: string[] }, o: { allow?: boolean } = {}) {
    const anon = await appAs({ anonymous: true });
    const unauth = await rpc(anon, 'tools/list');
    expect(unauth.statusCode).toBe(401);
    const meta = /resource_metadata="([^"]+)"/.exec(unauth.headers['www-authenticate'] as string)![1];
    const prm = (await anon.inject({ method: 'GET', url: meta.replace(GW, '') })).json();
    expect(prm).toMatchObject({ resource: `${GW}/mcp/${T}/hr-self-service`, authorization_servers: [`${GW}/oauth/${T}`] });
    const asm = (await anon.inject({ method: 'GET', url: `/.well-known/oauth-authorization-server/oauth/${T}` })).json();
    expect(asm).toMatchObject({ issuer: `${GW}/oauth/${T}`, code_challenge_methods_supported: ['S256'] });

    const redirectUri = 'http://localhost:7777/callback';
    const reg = (await anon.inject({ method: 'POST', url: `/oauth/${T}/register`, payload: { redirect_uris: [redirectUri], client_name: 'Claude Code', token_endpoint_auth_method: 'none' } })).json();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authz = await anon.inject({ method: 'GET', url: `/oauth/${T}/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', resource: prm.resource })}` });
    expect(authz.statusCode).toBe(302);
    const toIdp = new URL(authz.headers.location as string);
    expect(toIdp.origin + toIdp.pathname).toBe(`${idpBase}/authorize`);
    expect(toIdp.searchParams.get('redirect_uri')).toBe(`${GW}/oauth/callback`);

    const code = randomBytes(6).toString('hex');
    idpCodes.set(code, { ...person, nonce: toIdp.searchParams.get('nonce')! });
    const back = await anon.inject({ method: 'GET', url: `/oauth/callback?code=${code}&state=${encodeURIComponent(toIdp.searchParams.get('state')!)}` });
    if (back.statusCode !== 200) return { refused: back };
    expect(back.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
    expect(back.body).toContain(`Claude Code wants to use HR self-service as you`);
    const field = (n: string) => new RegExp(`name="${n}" value="([^"]+)"`).exec(back.body)![1];
    const consent = await anon.inject({ method: 'POST', url: `/oauth/${T}/consent`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ rid: field('rid'), token: field('token'), decision: o.allow === false ? 'deny' : 'allow' }).toString() });
    expect(consent.statusCode).toBe(303);
    const done = new URL(consent.headers.location as string);
    expect(done.searchParams.get('state')).toBe('st8');
    expect(done.searchParams.get('iss')).toBe(`${GW}/oauth/${T}`);
    if (o.allow === false) return { denied: done };
    // A code is used once.
    const form = { grant_type: 'authorization_code', code: done.searchParams.get('code')!, redirect_uri: redirectUri, client_id: reg.client_id, code_verifier: verifier, resource: prm.resource };
    const tokens = await anon.inject({ method: 'POST', url: `/oauth/${T}/token`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(form).toString() });
    expect(tokens.statusCode).toBe(200);
    const again = await anon.inject({ method: 'POST', url: `/oauth/${T}/token`, payload: form });
    expect(again.json().error).toBe('invalid_grant');
    return { anon, clientId: reg.client_id, ...tokens.json() as { access_token: string; refresh_token: string; expires_in: number } };
  }

  it('lets a person sign in through the company identity provider and use only the tools their groups allow', async () => {
    const admin = await appAs();
    await setUp(admin);
    await configureSignIn(admin);
    await patch(admin, { access: { allKeys: false, keyIds: [], people: 'groups', groups: ['HR'] } });
    await tool(admin, 'listSalaries', { groups: ['Payroll'] });
    await publish(admin);

    const s = await signIn({ sub: 'u1', email: 'Jane@Acme.example', groups: ['hr'] }) as any;
    expect(s.expires_in).toBe(900);
    const bearer = { authorization: `Bearer ${s.access_token}` };
    const tools = (await rpc(s.anon, 'tools/list', undefined, bearer)).json().result.tools.map((t: any) => t.name).sort();
    expect(tools).toEqual(['getEmployee', 'listEmployees']); // not salaries: Payroll only
    expect((await call(s.anon, 'getEmployee', { id: 'e1' }, bearer)).isError).toBe(false);
    const claims = await verifyJwt(seen[0].identity!, { issuer: GW, audience: base, key: (h) => keys.publicKey(h.kid) });
    expect(claims).toMatchObject({ sub: 'jane@acme.example', kind: 'person', groups: ['hr'], agent: 'Claude Code' });
    const [req] = audit.log.mock.calls[0] as any[];
    expect(req.metadata).toMatchObject({ caller: 'person', callerEmail: 'jane@acme.example' });
    expect(req.appId).toBe('Claude Code');

    // The token is for this server only, and only for this company.
    await admin.inject({ method: 'POST', url: '/v1/mcp/servers', payload: { name: 'Finance' } });
    const other = await s.anon.inject({ method: 'POST', url: `/mcp/${T}/finance`, headers: bearer, payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(other.statusCode).toBe(401);
    const tampered = s.access_token.slice(0, -4) + 'AAAA';
    expect((await rpc(s.anon, 'tools/list', undefined, { authorization: `Bearer ${tampered}` })).statusCode).toBe(401);

    // Someone outside the groups can't even finish signing in to this server.
    const outsider = await signIn({ sub: 'u2', email: 'max@acme.example', groups: ['Sales'] }) as any;
    expect(outsider.refused.statusCode).toBe(403);
    expect(outsider.refused.body).toContain('You don&#39;t have access to this MCP server');
  });

  it('refreshes sign-ins through the identity provider, ends them when it says no, and ends them when a refresh token is reused', async () => {
    const admin = await appAs();
    await setUp(admin);
    await configureSignIn(admin);
    await patch(admin, { access: { allKeys: false, keyIds: [], people: 'all', groups: [] } });
    await publish(admin);
    const s = await signIn({ sub: 'u3', email: 'lee@acme.example', groups: [] }) as any;
    const refresh = (rt: string) => s.anon.inject({ method: 'POST', url: `/oauth/${T}/token`, payload: { grant_type: 'refresh_token', refresh_token: rt, client_id: s.clientId } });

    const r1 = await refresh(s.refresh_token);
    expect(r1.statusCode).toBe(200);
    expect((await rpc(s.anon, 'tools/list', undefined, { authorization: `Bearer ${r1.json().access_token}` })).statusCode).toBe(200);
    // The old refresh token again: the whole sign-in ends, including the new refresh token.
    expect((await refresh(s.refresh_token)).json().error).toBe('invalid_grant');
    expect((await refresh(r1.json().refresh_token)).json().error).toBe('invalid_grant');

    // Disabled in the identity provider: the next refresh fails.
    const s2 = await signIn({ sub: 'u4', email: 'kim@acme.example', groups: [] }) as any;
    for (const v of idpRefresh.values()) if (v.sub === 'u4') v.disabled = true;
    expect((await s2.anon.inject({ method: 'POST', url: `/oauth/${T}/token`, payload: { grant_type: 'refresh_token', refresh_token: s2.refresh_token, client_id: s2.clientId } })).json())
      .toMatchObject({ error: 'invalid_grant', error_description: expect.stringMatching(/no longer accepts/) });
  });

  it('refuses sign-ins it can\'t vouch for', async () => {
    const admin = await appAs();
    await setUp(admin);
    const anon = await appAs({ anonymous: true });
    // Not set up: no metadata, no registration.
    expect((await anon.inject({ method: 'GET', url: `/.well-known/oauth-authorization-server/oauth/${T}` })).statusCode).toBe(404);
    await configureSignIn(admin);
    await patch(admin, { access: { allKeys: true, keyIds: [], people: 'all', groups: [] } });
    await publish(admin);
    expect((await anon.inject({ method: 'POST', url: `/oauth/${T}/register`, payload: { redirect_uris: ['http://evil.example/cb'] } })).json().error).toBe('invalid_redirect_uri');
    const reg = (await anon.inject({ method: 'POST', url: `/oauth/${T}/register`, payload: { redirect_uris: ['https://agent.example/cb'] } })).json();
    const q = (o: Record<string, string>) => `/oauth/${T}/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://agent.example/cb', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', ...o })}`;
    // An unregistered return address is never redirected to.
    const wrong = await anon.inject({ method: 'GET', url: q({ redirect_uri: 'https://evil.example/cb' }) });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.headers.location).toBeUndefined();
    expect(new URL((await anon.inject({ method: 'GET', url: q({ code_challenge_method: 'plain' }) })).headers.location as string).searchParams.get('error')).toBe('invalid_request');
    expect(new URL((await anon.inject({ method: 'GET', url: q({ resource: `${GW}/mcp/tenant_other/hr-self-service` }) })).headers.location as string).searchParams.get('error')).toBe('invalid_target');
    // A person who says no.
    const denied = await signIn({ sub: 'u5', email: 'no@acme.example', groups: [] }, { allow: false }) as any;
    expect(denied.denied.searchParams.get('error')).toBe('access_denied');
    // An API key without the mcp permission still gets 403, not a sign-in prompt.
    expect((await rpc(await appAs({ key: { keyId: 'k', scopes: ['chat'] } }), 'tools/list')).statusCode).toBe(403);
  });

  // ── Connector ───────────────────────────────────────────────────────────────────────────────

  it('reaches an API inside the company network through a connector', async () => {
    const admin = await appAs();
    const made = await admin.inject({ method: 'POST', url: '/v1/mcp/connectors', payload: { name: 'HQ data centre', allowedHosts: ['127.0.0.1'] } });
    expect(made.statusCode).toBe(201);
    const { token, connectorId } = made.json();
    expect(token).toMatch(/^pcn_tenant_acme\.con_/);
    expect(JSON.stringify((await admin.inject({ method: 'GET', url: '/v1/mcp/connectors' })).json())).not.toContain(token);

    await admin.inject({ method: 'POST', url: '/v1/mcp/servers', payload: { name: 'HR self-service' } });
    const notAllowed = await admin.inject({ method: 'POST', url: '/v1/mcp/servers/hr-self-service/apis', payload: { name: 'People API', baseUrl: 'http://hr.internal:8080', openapi: SPEC, connectorId, auth: { type: 'none' } } });
    expect(notAllowed.json().code).toBe('CONNECTOR_HOST_NOT_ALLOWED');
    expect((await admin.inject({ method: 'POST', url: '/v1/mcp/servers/hr-self-service/apis', payload: { name: 'People API', baseUrl: base, openapi: SPEC, connectorId, auth: { type: 'bearer', secret: 'backend-token-123' } } })).statusCode).toBe(201);
    await publish(admin);
    const a = await agent();

    // Offline until it checks in.
    expect((await call(a, 'getEmployee', { id: 'e1' })).content[0].text).toMatch(/connector HQ data centre is offline/);
    const conn = await appAs({ anonymous: true });
    const poll = () => conn.inject({ method: 'POST', url: '/connector/v1/poll', headers: { authorization: `Bearer ${token}` }, payload: { version: 'test-1' } });
    expect((await conn.inject({ method: 'POST', url: '/connector/v1/poll', headers: { authorization: 'Bearer pcn_tenant_acme.con_00.wrong' }, payload: {} })).statusCode).toBe(401);
    expect((await poll()).json()).toEqual({ jobs: [], allowedHosts: ['127.0.0.1'] });
    expect((await admin.inject({ method: 'GET', url: '/v1/mcp/connectors' })).json()[0]).toMatchObject({ online: true, agentVersion: 'test-1', apis: 1 });

    // The agent calls; the connector collects the call, makes it inside the network, and answers.
    const pending = call(a, 'getEmployee', { id: 'e1' });
    let jobs: any[] = [];
    for (let i = 0; i < 20 && !jobs.length; i++) jobs = (await poll()).json().jobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ method: 'GET', url: `${base}/employees/e1`, headers: { authorization: 'Bearer backend-token-123' } });
    const r = await fetch(jobs[0].url, { headers: jobs[0].headers });
    const answer = await conn.inject({ method: 'POST', url: '/connector/v1/answer', headers: { authorization: `Bearer ${token}` }, payload: { id: jobs[0].id, answer: { status: r.status, contentType: 'application/json', body: await r.text(), truncated: false, ms: 3 } } });
    expect(answer.json()).toEqual({ accepted: true });
    const result = await pending;
    expect(result).toMatchObject({ isError: false, content: [{ text: '{"id":"e1","name":"Jane"}' }] });
    expect((audit.log.mock.calls.at(-1) as any[])[0].metadata).toMatchObject({ connector: connectorId });

    // A connector in use can't be deleted.
    expect((await admin.inject({ method: 'DELETE', url: `/v1/mcp/connectors/${connectorId}` })).json().code).toBe('CONNECTOR_IN_USE');
  });
});
