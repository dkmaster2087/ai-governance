import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { requireAccess, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { connectRefusal } from '../mcp/access';
import { issuerFor, publicBase, serverResource } from '../mcp/base';
import type { Caller } from '../mcp/calls';
import { McpCredentialStore, hint } from '../mcp/credentials';
import { callBackend, checkBaseUrl } from '../mcp/egress';
import { decodeJwt, verifyJwt } from '../mcp/jwt';
import { GatewayKeys, gatewayKeys } from '../mcp/keys';
import { OidcClient, oidcClient, OidcError, Person, pkce, SignInConfig } from '../mcp/oidc';
import { consentPage, messagePage } from '../mcp/pages';
import { mcpStore } from '../mcp/store';
import { withDefaults } from '../mcp/types';
import { liveConfig } from '../mcp/versions';
import { signIns } from '../activity/sign-ins';

/**
 * OAuth 2.1 for MCP clients (Claude, ChatGPT, Cursor, VS Code…), so people can connect agents as themselves.
 *
 * Each company has its own issuer, <gateway>/oauth/<tenant>. A client discovers it from the MCP server's
 * protected-resource metadata, registers (dynamic registration or a client ID metadata document), and sends
 * the person to /authorize. Probaline sends them on to the company's identity provider, checks the ID token
 * that comes back, asks the person to allow the agent, and gives the client a code. The client exchanges it
 * (with PKCE) for a 15-minute access token for that one MCP server, and a refresh token.
 */

const logger = createLogger('gateway:mcp-oauth');
const records = () => collection<Record<string, any>>('mcpOauth');
const sha = (s: string) => createHash('sha256').update(s).digest('base64url');
const now = () => Math.floor(Date.now() / 1000);
const random = (n = 32) => randomBytes(n).toString('base64url');

export const ACCESS_TOKEN_SECONDS = 15 * 60;
const REQUEST_SECONDS = 10 * 60;
const CODE_SECONDS = 5 * 60;
/** With a refresh token from the identity provider, a sign-in lasts up to 30 days, checked at every refresh. */
const IDP_REFRESH_DAYS = 30;

interface Client { clientId: string; clientName: string; redirectUris: string[] }

const signInInput = z.object({
  issuer: z.string().trim().url().max(300),
  clientId: z.string().trim().min(1).max(300),
  clientSecret: z.string().min(1).max(2000).optional(),
  groupsClaim: z.string().trim().regex(/^[A-Za-z0-9_:./-]{1,80}$/).optional().default('groups'),
  extraScopes: z.array(z.string().regex(/^[\x21\x23-\x5b\x5d-\x7e]{1,80}$/)).max(10).optional().default([]),
  sessionHours: z.number().int().min(1).max(720).optional().default(8),
});

/** Where a client may send people back: https anywhere, http only to this computer, or an app's own scheme. */
export function redirectProblem(uri: string): string | null {
  let u: URL;
  try { u = new URL(uri); } catch { return 'is not a valid URL'; }
  if (u.hash) return 'must not have a fragment';
  const scheme = u.protocol.slice(0, -1).toLowerCase();
  if (scheme === 'https') return null;
  if (scheme === 'http') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ? null : 'may use http only for localhost';
  if (['javascript', 'data', 'file', 'vbscript', 'blob', 'about', 'ftp', 'ws', 'wss'].includes(scheme)) return `can't use ${scheme}:`;
  return /^[a-z][a-z0-9+.-]*$/.test(scheme) ? null : 'has an invalid scheme';
}

/** Exact match; for http on this computer the port may differ (RFC 8252). */
function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  try {
    const u = new URL(uri);
    if (u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return false;
    return registered.some((r) => { const x = new URL(r); return x.protocol === 'http:' && x.hostname === u.hostname && x.pathname === u.pathname && x.search === u.search; });
  } catch { return false; }
}

/** Check an access token Probaline gave a client, for one MCP server. Returns the person, or why not. */
export async function personFromToken(token: string, base: string, tenantId: string, serverId: string, keys: GatewayKeys = gatewayKeys()): Promise<Caller | null> {
  try {
    const claims = await verifyJwt(token, {
      issuer: issuerFor(base, tenantId), audience: [serverResource(base, tenantId, serverId), `${base}/mcp/${tenantId}`],
      typ: 'at+jwt', algorithms: ['ES256'], key: (h) => keys.publicKey(h.kid), skew: 30,
    });
    if (claims.tid !== tenantId || typeof claims.sub !== 'string' || !claims.sub.startsWith('person:')) return null;
    return {
      kind: 'person', id: claims.sub, userId: String(claims.email ?? claims.sub), appId: String(claims.client_name ?? claims.client_id ?? 'agent'),
      email: typeof claims.email === 'string' ? claims.email : undefined, name: typeof claims.name === 'string' ? claims.name : undefined,
      groups: Array.isArray(claims.groups) ? claims.groups.filter((g): g is string => typeof g === 'string') : [],
    };
  } catch {
    return null;
  }
}

export const looksLikeOurToken = (token: string, base: string) => {
  try { return String(decodeJwt(token).claims.iss ?? '').startsWith(`${base}/oauth/`); } catch { return false; }
};

export async function mcpOauthRoutes(app: FastifyInstance, opts: { oidc?: OidcClient; credentials?: McpCredentialStore; keys?: GatewayKeys } = {}) {
  const oidc = opts.oidc ?? oidcClient();
  const credentials = opts.credentials ?? new McpCredentialStore();
  const keys = () => opts.keys ?? gatewayKeys();

  // Token and registration requests arrive as forms or JSON.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(body as string))); } catch (err) { done(err as Error, undefined); }
  });

  const signIn = async (tenantId: string) => (await records().get({ tenantId, recordKey: 'signin' })) as SignInConfig | null;
  const html = (reply: FastifyReply, status: number, page: string, formTargets: string[] = []) => reply.status(status)
    .header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('x-frame-options', 'DENY')
    .header('content-security-policy', `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${formTargets.join(' ')}; frame-ancestors 'none'; base-uri 'none'`)
    .send(page);
  const oauthError = (reply: FastifyReply, error: string, description: string, status = 400) =>
    reply.status(status).header('cache-control', 'no-store').send({ error, error_description: description });

  // ── Discovery ──────────────────────────────────────────────────────────────────────────────────

  app.get('/.well-known/jwks.json', async (_req, reply) => reply.header('cache-control', 'public, max-age=300').send(await keys().jwks()));

  app.get('/.well-known/oauth-protected-resource/mcp/:tenantId/:serverId', async (request, reply) => {
    const { tenantId, serverId } = request.params as { tenantId: string; serverId: string };
    const base = publicBase(request);
    const server = await mcpStore.getServer(tenantId, serverId);
    if (!server || server.status === 'draft') return reply.status(404).send({ error: 'not_found' });
    return reply.header('cache-control', 'public, max-age=300').send({
      resource: serverResource(base, tenantId, serverId), authorization_servers: [issuerFor(base, tenantId)],
      bearer_methods_supported: ['header'], scopes_supported: ['mcp'], resource_name: server.name,
    });
  });

  const asMetadata = async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.params as { tenantId: string };
    if (!(await signIn(tenantId))) return reply.status(404).send({ error: 'not_found', error_description: 'This company has not set up sign-in for agents' });
    const iss = issuerFor(publicBase(request), tenantId);
    return reply.header('cache-control', 'public, max-age=300').send({
      issuer: iss, authorization_endpoint: `${iss}/authorize`, token_endpoint: `${iss}/token`, registration_endpoint: `${iss}/register`,
      revocation_endpoint: `${iss}/revoke`, jwks_uri: `${publicBase(request)}/.well-known/jwks.json`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['mcp'],
      client_id_metadata_document_supported: true,
    });
  };
  // RFC 8414 puts the issuer's path after the well-known part; some clients look under the issuer instead.
  app.get('/.well-known/oauth-authorization-server/oauth/:tenantId', asMetadata);
  app.get('/.well-known/openid-configuration/oauth/:tenantId', asMetadata);
  app.get('/oauth/:tenantId/.well-known/oauth-authorization-server', asMetadata);
  app.get('/oauth/:tenantId/.well-known/openid-configuration', asMetadata);

  // ── Clients ────────────────────────────────────────────────────────────────────────────────────

  app.post('/oauth/:tenantId/register', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    if (!(await signIn(tenantId))) return oauthError(reply, 'invalid_request', 'This company has not set up sign-in for agents', 404);
    const body = (request.body ?? {}) as Record<string, any>;
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    if (!uris.length || uris.length > 10 || !uris.every((u: unknown) => typeof u === 'string' && u.length <= 500)) {
      return oauthError(reply, 'invalid_redirect_uri', 'Give one to ten redirect_uris');
    }
    for (const u of uris) {
      const problem = redirectProblem(u);
      if (problem) return oauthError(reply, 'invalid_redirect_uri', `${u} ${problem}`);
    }
    if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none') {
      return oauthError(reply, 'invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none", with PKCE) are supported');
    }
    const clientId = `mcpc_${random(12)}`;
    const clientName = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : 'An AI agent';
    await records().put({ tenantId, recordKey: `client#${clientId}`, clientId, clientName, redirectUris: uris, createdAt: new Date().toISOString(), ttl: now() + 365 * 86_400 });
    logger.info('MCP client registered', { tenantId, clientId, clientName });
    return reply.status(201).send({
      client_id: clientId, client_id_issued_at: now(), client_name: clientName, redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
    });
  });

  /** A registered client, or one described by a client ID metadata document at its https client_id. */
  async function client(tenantId: string, clientId: string): Promise<Client | null> {
    if (!clientId.startsWith('https://')) {
      const r = await records().get({ tenantId, recordKey: `client#${clientId}` });
      return r ? { clientId, clientName: r.clientName, redirectUris: r.redirectUris } : null;
    }
    const key = { tenantId, recordKey: `client#${sha(clientId)}` };
    const cached = await records().get(key);
    if (cached && cached.until > now()) return { clientId, clientName: cached.clientName, redirectUris: cached.redirectUris };
    try {
      const r = await callBackend({ url: checkBaseUrl(clientId), method: 'GET', headers: { accept: 'application/json', 'user-agent': 'Probaline-MCP/1.0' }, maxBytes: 20_000, timeoutMs: 5000 });
      const doc = JSON.parse(r.body);
      if (r.status !== 200 || doc.client_id !== clientId || !Array.isArray(doc.redirect_uris) || doc.redirect_uris.some((u: unknown) => typeof u !== 'string' || redirectProblem(u))) return null;
      const c = { clientId, clientName: typeof doc.client_name === 'string' ? doc.client_name.slice(0, 80) : new URL(clientId).hostname, redirectUris: doc.redirect_uris.slice(0, 10) };
      await records().put({ ...key, ...c, until: now() + 3600, ttl: now() + 86_400 });
      return c;
    } catch (err) {
      logger.info('Client ID metadata document refused', { tenantId, clientId, error: (err as Error).message });
      return null;
    }
  }

  // ── Sign-in ────────────────────────────────────────────────────────────────────────────────────

  app.get('/oauth/:tenantId/authorize', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const q = request.query as Record<string, string | undefined>;
    const base = publicBase(request);
    const cfg = await signIn(tenantId);
    if (!cfg) return html(reply, 404, messagePage('Sign-in isn’t set up', 'This company hasn’t set up signing in to its MCP servers yet. Ask your administrator.'));
    const c = q.client_id ? await client(tenantId, q.client_id) : null;
    // Never redirect to an address we can't vouch for: show the problem here instead.
    if (!c) return html(reply, 400, messagePage('Unknown agent', 'This agent isn’t registered. Try connecting it again.'));
    if (!q.redirect_uri || !redirectMatches(c.redirectUris, q.redirect_uri)) return html(reply, 400, messagePage('Wrong return address', 'The agent asked to send you somewhere it didn’t register.'));

    const back = (error: string, description: string) => {
      const u = new URL(q.redirect_uri!);
      u.searchParams.set('error', error);
      u.searchParams.set('error_description', description);
      if (q.state) u.searchParams.set('state', q.state);
      u.searchParams.set('iss', issuerFor(base, tenantId));
      return reply.redirect(u.href, 302);
    };
    if (q.response_type !== 'code') return back('unsupported_response_type', 'Only the authorization code flow is supported');
    if (!q.code_challenge || q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) return back('invalid_request', 'PKCE with S256 is required');
    let resource = `${base}/mcp/${tenantId}`;
    let serverName = 'your company’s MCP servers';
    if (q.resource) {
      const m = q.resource.replace(/\/$/, '').match(/\/mcp\/([^/]+)\/([^/?#]+)$/);
      const server = m && m[1] === tenantId ? await mcpStore.getServer(tenantId, m[2]) : null;
      if (!m || !server || server.status === 'draft' || q.resource.replace(/\/$/, '') !== serverResource(base, tenantId, m[2])) return back('invalid_target', 'Unknown MCP server');
      resource = serverResource(base, tenantId, m[2]);
      serverName = server.name;
    }

    const rid = random(18);
    const { verifier, challenge } = pkce();
    const nonce = random(18);
    await records().put({
      tenantId, recordKey: `req#${rid}`, clientId: c.clientId, clientName: c.clientName, redirectUri: q.redirect_uri, codeChallenge: q.code_challenge,
      state: q.state ?? null, resource, serverName, verifier, nonce, ttl: now() + REQUEST_SECONDS,
    });
    try {
      const url = await oidc.authorizeUrl(cfg, { redirectUri: `${base}/oauth/callback`, state: `${tenantId}.${rid}`, nonce, challenge });
      return reply.redirect(url, 302);
    } catch (err) {
      logger.warn('Identity provider unavailable', { tenantId, error: (err as Error).message });
      return html(reply, 502, messagePage('Couldn’t reach your sign-in', (err as Error).message));
    }
  });

  /** The identity provider sends the person back here (one address for every company). */
  app.get('/oauth/callback', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const [tenantId, rid] = (q.state ?? '').split('.');
    const req = tenantId && rid ? await records().get({ tenantId, recordKey: `req#${rid}` }) : null;
    if (!req || req.person) return html(reply, 400, messagePage('This sign-in has expired', 'Start connecting the agent again.'));
    if (q.error) {
      signIns().mcp(request, tenantId, 'sign_in.mcp', 'failure', undefined, { reason: String(q.error).slice(0, 80), client: String(req.clientName ?? '').slice(0, 80) });
      return html(reply, 400, messagePage('Sign-in didn’t finish', String(q.error_description ?? q.error).slice(0, 200)));
    }
    const cfg = await signIn(tenantId);
    if (!cfg || !q.code) return html(reply, 400, messagePage('Sign-in didn’t finish', 'Start connecting the agent again.'));
    const base = publicBase(request);

    let person: Person;
    let idpRefresh: string | undefined;
    try {
      const secret = cfg.secretArn ? await credentials.get(cfg.secretArn) : '';
      const tokens = await oidc.exchange(cfg, secret, q.code, `${base}/oauth/callback`, req.verifier);
      person = await oidc.person(cfg, tokens.idToken, req.nonce);
      idpRefresh = tokens.refreshToken;
    } catch (err) {
      logger.warn('Sign-in failed', { tenantId, error: (err as Error).message });
      signIns().mcp(request, tenantId, 'sign_in.mcp', 'failure', undefined, { reason: (err as Error).message.slice(0, 160), client: String(req.clientName ?? '').slice(0, 80) });
      return html(reply, 401, messagePage('Sign-in didn’t work', err instanceof OidcError ? err.message : 'Your company’s sign-in couldn’t be checked.'));
    }

    // If the agent asked for one server, the person must be allowed on it.
    const serverId = req.resource.startsWith(`${base}/mcp/${tenantId}/`) ? req.resource.slice(`${base}/mcp/${tenantId}/`.length) : null;
    if (serverId) {
      const server = await mcpStore.getServer(tenantId, serverId);
      const caller: Caller = { kind: 'person', id: `person:${person.sub}`, userId: person.email ?? person.sub, appId: req.clientName, email: person.email, groups: person.groups };
      const refusal = !server ? 'This MCP server no longer exists.' : connectRefusal((await liveConfig(withDefaults(server))).config, caller);
      if (refusal) {
        signIns().mcp(request, tenantId, 'sign_in.mcp', 'denied', person, { reason: 'no_access', serverId, client: String(req.clientName ?? '').slice(0, 80), groups: person.groups.slice(0, 20).map((g) => g.slice(0, 80)).join(', ') || '(none sent)' });
        return html(reply, 403, messagePage('No access', refusal));
      }
    }
    signIns().mcp(request, tenantId, 'sign_in.mcp', 'success', person, { client: String(req.clientName ?? '').slice(0, 80), ...(serverId ? { serverId } : {}) });

    const token = random(24);
    await records().update({ tenantId, recordKey: `req#${rid}` }, {
      set: { person, consentToken: sha(token), ...(idpRefresh ? { idpRefresh: await keys().encrypt(idpRefresh) } : {}) }, where: { clientId: req.clientId },
    });
    const redirect = new URL(req.redirectUri);
    return html(reply, 200, consentPage({
      action: `${base}/oauth/${tenantId}/consent`, rid, token, client: req.clientName, server: req.serverName,
      who: person.email ?? person.name ?? person.sub, redirectHost: redirect.protocol === 'https:' || redirect.protocol === 'http:' ? redirect.host : `${redirect.protocol}//`,
    }), [new URL(base).origin, redirect.protocol === 'https:' || redirect.protocol === 'http:' ? redirect.origin : redirect.protocol]);
  });

  app.post('/oauth/:tenantId/consent', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const body = (request.body ?? {}) as Record<string, string>;
    const key = { tenantId, recordKey: `req#${body.rid ?? ''}` };
    const req = body.rid ? await records().get(key) : null;
    if (!req || !req.person || !body.token || req.consentToken !== sha(body.token)) return html(reply, 400, messagePage('This sign-in has expired', 'Start connecting the agent again.'));
    await records().delete(key); // one decision per sign-in
    const back = new URL(req.redirectUri);
    if (req.state) back.searchParams.set('state', req.state);
    back.searchParams.set('iss', issuerFor(publicBase(request), tenantId));
    if (body.decision !== 'allow') {
      back.searchParams.set('error', 'access_denied');
      back.searchParams.set('error_description', 'The person didn’t allow the agent');
      signIns().mcp(request, tenantId, 'sign_in.mcp_agent_refused', 'denied', req.person, { client: String(req.clientName ?? '').slice(0, 80) });
      return reply.redirect(back.href, 303);
    }
    const code = random(32);
    await records().put({
      tenantId, recordKey: `code#${sha(code)}`, status: 'new', clientId: req.clientId, clientName: req.clientName, redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge, resource: req.resource, person: req.person, ...(req.idpRefresh ? { idpRefresh: req.idpRefresh } : {}), ttl: now() + CODE_SECONDS,
    });
    logger.info('Agent allowed', { tenantId, clientId: req.clientId, resource: req.resource });
    signIns().mcp(request, tenantId, 'sign_in.mcp_agent_allowed', 'success', req.person, { client: String(req.clientName ?? '').slice(0, 80), resource: String(req.resource).slice(0, 200) });
    back.searchParams.set('code', code);
    return reply.redirect(back.href, 303);
  });

  // ── Tokens ─────────────────────────────────────────────────────────────────────────────────────

  async function issue(tenantId: string, base: string, g: { clientId: string; clientName: string; resource: string; person: Person; family: string; sessionEndsAt: number; idpRefresh?: string }) {
    const t = now();
    const access = await keys().sign({
      iss: issuerFor(base, tenantId), aud: g.resource, sub: `person:${g.person.sub}`, tid: tenantId, client_id: g.clientId, client_name: g.clientName,
      ...(g.person.email ? { email: g.person.email } : {}), ...(g.person.name ? { name: g.person.name } : {}), groups: g.person.groups.slice(0, 100),
      scope: 'mcp', iat: t, exp: t + ACCESS_TOKEN_SECONDS, jti: random(9),
    }, 'at+jwt');
    const refresh = random(32);
    await records().put({
      tenantId, recordKey: `refresh#${sha(refresh)}`, status: 'active', family: g.family, clientId: g.clientId, clientName: g.clientName,
      resource: g.resource, person: g.person, sessionEndsAt: g.sessionEndsAt, ...(g.idpRefresh ? { idpRefresh: g.idpRefresh } : {}), ttl: g.sessionEndsAt,
    });
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS, refresh_token: refresh, scope: 'mcp' };
  }

  app.post('/oauth/:tenantId/token', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const b = (request.body ?? {}) as Record<string, string>;
    const base = publicBase(request);
    const cfg = await signIn(tenantId);
    if (!cfg) return oauthError(reply, 'invalid_request', 'This company has not set up sign-in for agents');

    if (b.grant_type === 'authorization_code') {
      if (!b.code || !b.code_verifier || !b.client_id) return oauthError(reply, 'invalid_request', 'code, code_verifier and client_id are required');
      const key = { tenantId, recordKey: `code#${sha(b.code)}` };
      const code = await records().update(key, { set: { status: 'used' }, where: { status: 'new' } });
      if (!code) return oauthError(reply, 'invalid_grant', 'The code is unknown, expired or already used');
      await records().delete(key);
      if (code.clientId !== b.client_id) return oauthError(reply, 'invalid_grant', 'The code was given to another client');
      if (b.redirect_uri !== code.redirectUri) return oauthError(reply, 'invalid_grant', 'redirect_uri doesn\'t match');
      if (sha(b.code_verifier) !== code.codeChallenge) return oauthError(reply, 'invalid_grant', 'The code verifier doesn\'t match');
      if (b.resource && b.resource.replace(/\/$/, '') !== code.resource) return oauthError(reply, 'invalid_target', 'The resource doesn\'t match the one signed in for');
      const sessionEndsAt = now() + (code.idpRefresh ? IDP_REFRESH_DAYS * 86_400 : cfg.sessionHours * 3600);
      return issue(tenantId, base, { clientId: code.clientId, clientName: code.clientName, resource: code.resource, person: code.person, family: random(12), sessionEndsAt, idpRefresh: code.idpRefresh });
    }

    if (b.grant_type === 'refresh_token') {
      if (!b.refresh_token || !b.client_id) return oauthError(reply, 'invalid_request', 'refresh_token and client_id are required');
      const key = { tenantId, recordKey: `refresh#${sha(b.refresh_token)}` };
      const old = await records().get(key);
      if (!old || old.clientId !== b.client_id) return oauthError(reply, 'invalid_grant', 'Unknown refresh token');
      const familyKey = { tenantId, recordKey: `family#${old.family}` };
      if ((await records().get(familyKey))?.status === 'revoked') return oauthError(reply, 'invalid_grant', 'This sign-in was ended');
      const used = await records().update(key, { set: { status: 'used' }, where: { status: 'active' } });
      if (!used) {
        // A refresh token used twice: someone else may have it. End the whole sign-in.
        await records().put({ ...familyKey, status: 'revoked', ttl: old.sessionEndsAt });
        logger.warn('Refresh token reused; sign-in ended', { tenantId, clientId: old.clientId });
        signIns().mcp(request, tenantId, 'sign_in.mcp_refresh_reused', 'denied', old.person, { client: String(old.clientName ?? '').slice(0, 80) });
        return oauthError(reply, 'invalid_grant', 'This refresh token was already used; sign in again');
      }
      if (old.sessionEndsAt <= now()) return oauthError(reply, 'invalid_grant', 'The sign-in has expired; sign in again');
      let person: Person = old.person;
      let idpRefresh: string | undefined = old.idpRefresh;
      if (idpRefresh) {
        // Ask the identity provider again: someone removed or disabled there loses access now.
        try {
          const secret = cfg.secretArn ? await credentials.get(cfg.secretArn) : '';
          const tokens = await oidc.refresh(cfg, secret, await keys().decrypt(idpRefresh));
          const fresh = await oidc.person(cfg, tokens.idToken);
          if (fresh.sub !== person.sub) return oauthError(reply, 'invalid_grant', 'The identity provider returned someone else');
          person = fresh;
          if (tokens.refreshToken) idpRefresh = await keys().encrypt(tokens.refreshToken);
        } catch (err) {
          logger.info('Identity provider refused a refresh', { tenantId, error: (err as Error).message });
          signIns().mcp(request, tenantId, 'sign_in.mcp_refresh', 'denied', person, { reason: (err as Error).message.slice(0, 160) });
          return oauthError(reply, 'invalid_grant', 'Your company’s sign-in no longer accepts this session; sign in again');
        }
      }
      return issue(tenantId, base, { clientId: old.clientId, clientName: old.clientName, resource: old.resource, person, family: old.family, sessionEndsAt: old.sessionEndsAt, idpRefresh });
    }
    return oauthError(reply, 'unsupported_grant_type', 'Use authorization_code or refresh_token');
  });

  app.post('/oauth/:tenantId/revoke', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const b = (request.body ?? {}) as Record<string, string>;
    if (b.token) {
      const old = await records().get({ tenantId, recordKey: `refresh#${sha(b.token)}` });
      if (old) {
        await records().put({ tenantId, recordKey: `family#${old.family}`, status: 'revoked', ttl: old.sessionEndsAt });
        signIns().mcp(request, tenantId, 'sign_in.mcp_signed_out', 'success', old.person, { client: String(old.clientName ?? '').slice(0, 80) });
      }
    }
    return reply.status(200).send({});
  });

  // ── Admin: the company's identity provider ─────────────────────────────────────────────────────

  const view = (cfg: SignInConfig | null, base: string) => ({
    configured: !!cfg, callbackUrl: `${base}/oauth/callback`,
    ...(cfg ? { issuer: cfg.issuer, clientId: cfg.clientId, secretHint: cfg.secretHint, groupsClaim: cfg.groupsClaim, extraScopes: cfg.extraScopes, sessionHours: cfg.sessionHours, updatedAt: cfg.updatedAt } : {}),
  });

  app.get('/v1/mcp/sign-in', { preHandler: requireAccess(TENANT_READ) }, async (request) => view(await signIn(request.tenantId), publicBase(request)));

  app.put('/v1/mcp/sign-in', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = signInInput.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid settings', code: 'INVALID_SIGN_IN' });
    const existing = await signIn(request.tenantId);
    const d = parsed.data;
    try { checkBaseUrl(d.issuer.replace(/\/$/, '')); } catch (err) { return reply.status(400).send({ error: (err as Error).message, code: 'INVALID_SIGN_IN' }); }
    if (!d.clientSecret && !existing?.secretArn) return reply.status(400).send({ error: 'The client secret is required', code: 'INVALID_SIGN_IN' });
    // A new name for each secret: a deleted one stays reserved during the secret store's recovery window.
    const secretArn = d.clientSecret ? await credentials.save(request.tenantId, `signin-${random(6)}`, d.clientSecret) : existing!.secretArn;
    const cfg: SignInConfig = {
      tenantId: request.tenantId, recordKey: 'signin', issuer: d.issuer.replace(/\/$/, ''), clientId: d.clientId, secretArn,
      secretHint: d.clientSecret ? hint(d.clientSecret) : existing?.secretHint, groupsClaim: d.groupsClaim, extraScopes: d.extraScopes,
      sessionHours: d.sessionHours, updatedAt: new Date().toISOString(), updatedBy: request.userId,
    };
    await records().put(cfg as unknown as Record<string, unknown>);
    if (d.clientSecret && existing?.secretArn && existing.secretArn !== secretArn) await credentials.remove(existing.secretArn);
    logger.info('MCP sign-in configured', { tenantId: request.tenantId, issuer: cfg.issuer, by: request.userId });
    return view(cfg, publicBase(request));
  });

  /** Check the identity provider can be reached and describes itself as the configured issuer. */
  app.post('/v1/mcp/sign-in/check', { preHandler: requireAccess(TENANT_ADMIN) }, async (request) => {
    const cfg = await signIn(request.tenantId);
    if (!cfg) return { ok: false, message: 'Sign-in isn’t set up yet.' };
    try {
      const d = await oidc.discover(cfg.issuer);
      return { ok: true, message: `Found ${d.issuer}. People will be sent to ${new URL(d.authorization_endpoint).host} to sign in.` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  app.delete('/v1/mcp/sign-in', { preHandler: requireAccess(TENANT_ADMIN) }, async (request) => {
    const cfg = await signIn(request.tenantId);
    if (cfg) {
      await credentials.remove(cfg.secretArn);
      await records().delete({ tenantId: request.tenantId, recordKey: 'signin' });
    }
    return { ok: true };
  });
}
