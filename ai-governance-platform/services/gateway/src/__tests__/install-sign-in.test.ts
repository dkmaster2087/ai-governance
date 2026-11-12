import fs from 'fs';
import os from 'os';
import path from 'path';
import Fastify from 'fastify';
import { collection, MemoryStore, setRecords } from '@ai-governance/storage';
import { GatewayKeys, MemoryVault, setGatewayKeys } from '../mcp/keys';
import {
  bootstrapInstall, hashPassword, InstallSessionVerifier, LocalAccounts, passwordMatches, passwordProblem, signInWithPassword, signInWithSso,
} from '../install/sign-in';
import { installSignInRoutes } from '../install/sign-in.routes';
import { serveDashboard, stripApiPrefix } from '../install/dashboard';
import { UserDirectory } from '../services/user-directory';

const T = 'tenant_local';
const GOOD = 'Correct-Horse-9-battery';

async function addPerson(email: string, role = 'tenant_admin') {
  const dir = new UserDirectory(new LocalAccounts());
  return dir.invite({ tenantId: T, email, givenName: 'Ana', familyName: 'Lee', role: role as never }, 'admin@acme.com');
}

beforeEach(() => {
  setRecords(new MemoryStore());
  setGatewayKeys(new GatewayKeys(new MemoryVault()));
  delete process.env.PROBALINE_SSO_ISSUER;
});
afterAll(() => setGatewayKeys(null));

describe('passwords', () => {
  it('asks for a strong one, and stores only a salted hash', async () => {
    expect(passwordProblem('short')).toMatch(/12 characters/);
    expect(passwordProblem('alllowercaseletters')).toMatch(/upper and lower/);
    expect(passwordProblem(GOOD)).toBeNull();
    const h = await hashPassword(GOOD);
    expect(h).not.toContain(GOOD);
    expect(await passwordMatches(GOOD, h)).toBe(true);
    expect(await passwordMatches('Correct-Horse-9-batterY', h)).toBe(false);
  });
});

describe('signing in to an install', () => {
  it('gives an invited person a temporary password, which must be replaced at first sign-in', async () => {
    const invited = await addPerson('ana@acme.com');
    expect(invited.temporaryPassword).toEqual(expect.any(String));
    // The Users page's records never hold the hash.
    expect(JSON.stringify(await collection('users').get({ tenantId: T, email: 'ana@acme.com' }))).not.toMatch(/scrypt/);
    await expect(signInWithPassword('ana@acme.com', invited.temporaryPassword!)).rejects.toMatchObject({ code: 'NEW_PASSWORD_REQUIRED', statusCode: 409 });
    await expect(signInWithPassword('ana@acme.com', invited.temporaryPassword!, 'weak')).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });
    const s = await signInWithPassword('ana@acme.com', invited.temporaryPassword!, GOOD);
    expect(s.user).toMatchObject({ email: 'ana@acme.com', role: 'tenant_admin', tenantId: T });
    // The session carries what every permission check reads, as a Cloud sign-in does.
    expect(await new InstallSessionVerifier().verify(s.token)).toMatchObject({ email: 'ana@acme.com', 'custom:tenantId': T, 'custom:role': 'tenant_admin' });
    // The temporary password no longer works; the new one does, without asking again.
    await expect(signInWithPassword('ana@acme.com', invited.temporaryPassword!)).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    expect((await signInWithPassword('ana@acme.com', GOOD)).token).toEqual(expect.any(String));
  });

  it('answers the same for an unknown person, and locks an account after five wrong passwords', async () => {
    await expect(signInWithPassword('nobody@acme.com', GOOD)).rejects.toMatchObject({ code: 'WRONG_PASSWORD', message: 'That email and password don’t match.' });
    const invited = await addPerson('ana@acme.com');
    await signInWithPassword('ana@acme.com', invited.temporaryPassword!, GOOD);
    for (let i = 0; i < 5; i++) await expect(signInWithPassword('ana@acme.com', 'Wrong-Password-1')).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    await expect(signInWithPassword('ana@acme.com', GOOD)).rejects.toMatchObject({ code: 'LOCKED', statusCode: 429 });
  });

  it('ends the sessions of someone turned off or removed', async () => {
    const dir = new UserDirectory(new LocalAccounts());
    const invited = await addPerson('ana@acme.com');
    const s = await signInWithPassword('ana@acme.com', invited.temporaryPassword!, GOOD);
    const verifier = new InstallSessionVerifier();
    await verifier.verify(s.token);
    await dir.setEnabled((await dir.get(T, 'ana@acme.com'))!, false);
    await expect(verifier.verify(s.token)).rejects.toThrow(/no longer sign in/);
    await expect(signInWithPassword('ana@acme.com', GOOD)).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
  });

  it('lets only people on the Users page in through company sign-in', async () => {
    await expect(signInWithSso('stranger@acme.com')).rejects.toMatchObject({ code: 'SSO_NOT_A_USER', statusCode: 403 });
    await expect(signInWithSso(undefined)).rejects.toMatchObject({ code: 'SSO_NO_EMAIL' });
    await addPerson('ana@acme.com', 'tenant_auditor');
    expect((await signInWithSso('ANA@acme.com')).user.role).toBe('tenant_auditor');
  });

  it('makes the company and its first admin on first start', async () => {
    process.env.PROBALINE_ADMIN_EMAIL = 'it@acme.com';
    process.env.PROBALINE_ADMIN_PASSWORD = 'Temporary-Pass-1';
    process.env.PROBALINE_COMPANY_NAME = 'Acme';
    try {
      await bootstrapInstall();
      await bootstrapInstall(); // a second start changes nothing
      expect(await collection('tenants').get({ tenantId: T })).toMatchObject({ name: 'Acme', status: 'active' });
      await expect(signInWithPassword('it@acme.com', 'Temporary-Pass-1')).rejects.toMatchObject({ code: 'NEW_PASSWORD_REQUIRED' });
    } finally {
      delete process.env.PROBALINE_ADMIN_EMAIL; delete process.env.PROBALINE_ADMIN_PASSWORD; delete process.env.PROBALINE_COMPANY_NAME;
    }
  });
});

describe('sign-in routes', () => {
  it('says which ways to sign in exist, and signs in with a password', async () => {
    const app = Fastify();
    await app.register(installSignInRoutes, { prefix: '/v1' });
    expect((await app.inject({ method: 'GET', url: '/v1/auth/methods' })).json()).toEqual({ password: true, sso: null });
    const invited = await addPerson('ana@acme.com');
    const first = await app.inject({ method: 'POST', url: '/v1/auth/password', payload: { email: 'ana@acme.com', password: invited.temporaryPassword } });
    expect(first.statusCode).toBe(409);
    const ok = await app.inject({ method: 'POST', url: '/v1/auth/password', payload: { email: 'ana@acme.com', password: invited.temporaryPassword, newPassword: GOOD } });
    expect(ok.json()).toMatchObject({ token: expect.any(String), user: { email: 'ana@acme.com' } });
    const sso = await app.inject({ method: 'GET', url: '/v1/auth/sso/start' });
    expect(sso.statusCode).toBe(302);
    expect(sso.headers.location).toMatch(/^\/login#error=/);
  });
});

describe('company sign-in (SSO)', () => {
  const { OidcClient } = jest.requireActual('../mcp/oidc');
  beforeEach(() => {
    Object.assign(process.env, { PROBALINE_SSO_ISSUER: 'https://idp.acme.com', PROBALINE_SSO_CLIENT_ID: 'probaline', PROBALINE_SSO_CLIENT_SECRET: 's3cret', PROBALINE_SSO_NAME: 'Acme Okta', PUBLIC_GATEWAY_URL: 'https://ai-gateway.acme.com' });
  });
  afterEach(() => {
    for (const k of ['PROBALINE_SSO_ISSUER', 'PROBALINE_SSO_CLIENT_ID', 'PROBALINE_SSO_CLIENT_SECRET', 'PROBALINE_SSO_NAME', 'PUBLIC_GATEWAY_URL']) delete process.env[k];
    jest.restoreAllMocks();
  });

  it('sends people to their identity provider and back, signing in only someone on the Users page', async () => {
    let asked: any;
    jest.spyOn(OidcClient.prototype, 'authorizeUrl').mockImplementation(async (_c: any, o: any) => { asked = o; return `https://idp.acme.com/authorize?state=${o.state}`; });
    jest.spyOn(OidcClient.prototype, 'exchange').mockResolvedValue({ idToken: 'id-token' } as never);
    const person = jest.spyOn(OidcClient.prototype, 'person').mockResolvedValue({ sub: 'x', email: 'ana@acme.com', groups: [] } as never);
    const app = Fastify();
    await app.register(installSignInRoutes, { prefix: '/v1' });
    expect((await app.inject({ method: 'GET', url: '/v1/auth/methods' })).json().sso).toEqual({ name: 'Acme Okta' });

    const start = async () => {
      const r = await app.inject({ method: 'GET', url: '/v1/auth/sso/start' });
      expect(r.headers.location).toMatch(/^https:\/\/idp\.acme\.com\/authorize/);
      expect(asked.redirectUri).toBe('https://ai-gateway.acme.com/v1/auth/sso/callback');
      return asked.state as string;
    };
    const back = (state: string) => app.inject({ method: 'GET', url: `/v1/auth/sso/callback?code=c&state=${state}` }).then((r) => r.headers.location as string);

    // Not on the Users page: refused, with the reason handed back to the sign-in page.
    expect(await back(await start())).toMatch(/^\/login#error=.*isn%E2%80%99t\+a\+Probaline\+user/);
    await addPerson('ana@acme.com');
    const state = await start();
    const ok = await back(state);
    expect(ok).toMatch(/^\/login#session=/);
    const token = new URLSearchParams(ok.split('#')[1]).get('session')!;
    expect(await new InstallSessionVerifier().verify(token)).toMatchObject({ email: 'ana@acme.com', 'custom:role': 'tenant_admin' });
    // The nonce sent to the provider is the one checked on the way back.
    expect(person.mock.calls.at(-1)?.[2]).toBe(asked.nonce);
    // A state is good once.
    expect(await back(state)).toMatch(/already\+used/);
    expect(await back("made-up")).toMatch(/already\+used/);
  });
});

describe('the dashboard, served by the install', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Probaline</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'app-1a2b.js'), 'console.log(1)');
  fs.writeFileSync(path.join(os.tmpdir(), 'secret.txt'), 'outside');

  it('serves its files and pages, keeps the API’s 404s, and never reads outside its folder', async () => {
    const app = Fastify({ rewriteUrl: (req) => stripApiPrefix(req.url ?? '/') });
    app.get('/v1/rules', async () => ({ rules: [] }));
    await serveDashboard(app, dir);
    const get = (url: string) => app.inject({ method: 'GET', url });
    expect((await get('/api/v1/rules')).json()).toEqual({ rules: [] });
    const asset = await get('/assets/app-1a2b.js');
    expect(asset.headers['content-type']).toMatch(/javascript/);
    expect(asset.headers['cache-control']).toMatch(/immutable/);
    const page = await get('/evidence');
    expect(page.body).toContain('<title>Probaline</title>');
    expect(page.headers['cache-control']).toBe('no-cache');
    expect((await get('/v1/nothing')).statusCode).toBe(404);
    expect((await get('/api/v1/nothing')).json().error).toBe('Not Found');
    expect((await get('/assets/../../secret.txt')).body).not.toContain('outside');
    expect((await get('/%2e%2e/secret.txt')).body).not.toContain('outside');
  });
});
