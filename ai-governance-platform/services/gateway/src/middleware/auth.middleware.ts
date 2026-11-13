import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasCaps, keySpend } from '../services/key-spend';
import { installSignIn, InstallSessionVerifier } from '../install/sign-in';
import { API_PATHS } from '../install/dashboard';
import fp from 'fastify-plugin';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { createLogger } from '@ai-governance/utils';
import { ApiKey, ApiKeyRepository, hashApiKey } from '../repositories/api-key.repository';
import { getSecurityConfig } from '../config/security';
import { Principal, isUserRole } from '../auth/principal';
import { tenantSettings } from '../services/tenant-settings.service';
import { LicenseStatus, licenseState } from '../services/license-state';
import { RateCounter, rateCounter } from '../services/rate-counter';
import { SignInRecorder, signIns } from '../activity/sign-ins';

const logger = createLogger('gateway:auth');

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
    /** The tenant this request acts on. Always set from verified credentials, never trusted from headers alone. */
    tenantId: string;
    userId: string;
    appId: string;
  }
}

/** Routes that need no credentials. */
const PUBLIC_PREFIXES = ['/health', '/public/',
  // An install's own sign-in (registered only there): each route is a way to sign in.
  '/v1/auth/',
  // OAuth for MCP clients and published keys: open by design (each route checks what it needs).
  '/.well-known/', '/oauth/',
  // Connectors authenticate with their own token in the route.
  '/connector/v1/'];
/** MCP addresses accept a Probaline API key here, or a sign-in token the MCP route checks itself. */
const MCP_PREFIX = '/mcp/';
const PROXY_PREFIX = '/v1/proxy/';
/** How often a key's "last used" time is written. */
const TOUCH_EVERY_MS = 60_000;
/** Other gateways' guardrail hooks: LiteLLM sends its guardrail key as x-api-key. */
const GUARDRAILS_PREFIX = '/v1/guardrails/';

/** Claims we read from a verified Cognito ID token. */
export interface UserTokenClaims {
  sub: string;
  email?: string;
  'custom:tenantId'?: string;
  'custom:role'?: string;
  /** When the person actually signed in (epoch seconds); the same across token refreshes. */
  auth_time?: number;
}

export interface UserTokenVerifier {
  verify(token: string): Promise<UserTokenClaims>;
}

export interface ApiKeyLookup {
  findByHash(keyHash: string): Promise<ApiKey | null>;
  touchLastUsed(tenantId: string, keyId: string): Promise<void>;
}

export interface AuthDeps {
  keys: ApiKeyLookup;
  /** Tenant status lookup; suspended tenants are refused. */
  tenantStatus?: (tenantId: string) => Promise<string | null>;
  /** License state; once a company's grace period is over, its AI traffic is refused. */
  licenseStatus?: (tenantId: string) => Promise<LicenseStatus | null>;
  userTokens?: UserTokenVerifier;
  /** Per-key limits, shared by every gateway instance. */
  rate?: Pick<RateCounter, 'hit'>;
  devAuth: boolean;
  keyCacheTtlMs: number;
  /** Where sign-ins and refused keys are recorded. */
  signIns?: SignInRecorder;
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function looksLikeJwt(token: string): boolean {
  return token.split('.').length === 3;
}

function deny(reply: FastifyReply, status: 401 | 403, code: string, error: string) {
  return reply.status(status).send({ error, code });
}

type KeyCache = Map<string, { key: ApiKey; cachedUntil: number }>;
/** Every auth plugin's key cache in this process, so a revoked key can be dropped from all of them. */
const keyCaches = new Set<KeyCache>();

/**
 * Stop trusting a cached copy of this key in this process. Call after revoking, rotating or deleting it.
 * Other gateway instances drop it when their cache entry expires (keyCacheTtlMs, one minute by default).
 */
/** AI requests, where tokens are spent: chat completions and IDE proxy mode. */
const AI_PATH = /^\/(v1\/)?(chat\/completions|proxy\/(?!providers)[^/]+\/)/;

export function forgetApiKey(keyId: string): void {
  for (const cache of keyCaches) {
    for (const [hash, entry] of cache) if (entry.key.keyId === keyId) cache.delete(hash);
  }
}

export function createAuthPlugin(deps: AuthDeps) {
  const servesDashboard = installSignIn();
  const keyCache: KeyCache = new Map();
  /** When each key's last-used time was last written by this copy. */
  const lastTouched = new Map<string, number>();
  keyCaches.add(keyCache);

  async function resolveApiKey(token: string): Promise<ApiKey | null> {
    const keyHash = hashApiKey(token);
    const cached = keyCache.get(keyHash);
    if (cached && cached.cachedUntil > Date.now()) return cached.key;

    const key = await deps.keys.findByHash(keyHash);
    if (key) keyCache.set(keyHash, { key, cachedUntil: Date.now() + deps.keyCacheTtlMs });
    return key;
  }

  return fp(async function authPlugin(app: FastifyInstance) {
    app.decorateRequest('principal', null);

    app.addHook('preHandler', async (request, reply) => {
      if (PUBLIC_PREFIXES.some((p) => request.url.startsWith(p))) return;
      const path = request.url.split('?')[0];
      // An install's dashboard pages and files are public (they hold no data); everything they show comes from the API.
      if (servesDashboard && !API_PATHS.test(path)) return;
      // CORS preflight never carries credentials
      if (request.method === 'OPTIONS') return;

      // In proxy mode the client's Authorization header carries its own provider key and is forwarded
      // untouched, so the Probaline credential travels in x-probaline-key (injected by the corporate proxy).
      const isProxyRoute = request.url.startsWith(PROXY_PREFIX);
      const authHeader = isProxyRoute
        ? header(request, 'x-probaline-key')
        : header(request, 'authorization') ?? (request.url.startsWith(GUARDRAILS_PREFIX) ? header(request, 'x-api-key') : undefined);
      const isMcpRoute = request.url.startsWith(MCP_PREFIX);
      // No credentials, or a token from Probaline's own sign-in: the MCP route answers (and says where to sign in).
      if (isMcpRoute && (!authHeader || looksLikeJwt(authHeader.replace(/^Bearer /, '').trim()))) return;
      if (!authHeader) return deny(reply, 401, 'MISSING_AUTH', 'Unauthorized');
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
      if (!token) return deny(reply, 401, 'MISSING_AUTH', 'Unauthorized');

      const requestedTenant = header(request, 'x-tenant-id');

      // ── Local development shortcut (explicit opt-in, never in prod) ──────────
      if (deps.devAuth && token === 'test-key') {
        if (!requestedTenant) return deny(reply, 401, 'MISSING_TENANT', 'x-tenant-id header required in dev mode');
        const devRole = header(request, 'x-dev-role') ?? 'tenant_admin';
        if (!isUserRole(devRole)) return deny(reply, 401, 'INVALID_ROLE', 'Unknown x-dev-role');
        const homeTenantId = devRole === 'platform_admin' ? 'tenant_platform' : requestedTenant;
        request.principal = {
          kind: 'user',
          homeTenantId,
          userId: header(request, 'x-user-id') ?? 'dev-user',
          role: devRole,
        };
        request.tenantId = requestedTenant;
        request.userId = request.principal.userId;
        request.appId = header(request, 'x-app-id') ?? 'dashboard';
        return;
      }

      // ── Dashboard users (Cognito ID token) ──────────────────────────────────
      if (looksLikeJwt(token)) {
        if (!deps.userTokens) return deny(reply, 401, 'USER_AUTH_DISABLED', 'User sign-in is not configured');
        let claims: UserTokenClaims;
        try {
          claims = await deps.userTokens.verify(token);
        } catch (err) {
          logger.info('Rejected user token', { error: (err as Error).message });
          return deny(reply, 401, 'INVALID_TOKEN', 'Invalid or expired token');
        }
        const homeTenantId = claims['custom:tenantId'];
        const role = claims['custom:role'];
        if (!homeTenantId || !isUserRole(role)) {
          return deny(reply, 403, 'INCOMPLETE_PROFILE', 'User has no tenant or role assigned');
        }
        // Only platform admins may act on a tenant other than their own.
        const tenantId = requestedTenant ?? homeTenantId;
        if (tenantId !== homeTenantId && role !== 'platform_admin') {
          return deny(reply, 403, 'TENANT_MISMATCH', 'You do not have access to this tenant');
        }
        request.principal = { kind: 'user', homeTenantId, userId: claims.sub, email: claims.email, role };
        request.tenantId = tenantId;
        request.userId = claims.sub;
        request.appId = header(request, 'x-app-id') ?? 'dashboard';
        deps.signIns?.dashboardSession(request, homeTenantId, claims);
        return;
      }

      // ── Machine callers (tenant API key) ────────────────────────────────────
      let apiKey: ApiKey | null;
      try {
        apiKey = await resolveApiKey(token);
      } catch (err) {
        logger.error('API key lookup failed', { error: (err as Error).message });
        return reply.status(503).send({ error: 'Authentication temporarily unavailable', code: 'AUTH_UNAVAILABLE' });
      }
      // An unknown key belongs to no tenant, so it can only be a log line (anyone can send one).
      if (!apiKey) {
        logger.info('Unknown API key refused', { requestId: request.correlationId, sourceIp: request.clientIp });
        return deny(reply, 401, 'INVALID_KEY', 'Invalid API key');
      }
      if (apiKey.status === 'revoked') {
        deps.signIns?.keyRefused(request, apiKey, 'KEY_REVOKED');
        return deny(reply, 401, 'KEY_REVOKED', 'API key has been revoked');
      }
      if (apiKey.status === 'expired' || (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date())) {
        deps.signIns?.keyRefused(request, apiKey, 'KEY_EXPIRED');
        return deny(reply, 401, 'KEY_EXPIRED', 'API key has expired');
      }
      if (requestedTenant && requestedTenant !== apiKey.tenantId) {
        deps.signIns?.keyRefused(request, apiKey, 'TENANT_MISMATCH');
        return deny(reply, 403, 'TENANT_MISMATCH', 'API key does not belong to this tenant');
      }

      // x-user-id from an app is attribution for the app's own end users, not proof of identity.
      const userId = header(request, 'x-user-id') ?? 'anonymous';
      const appId = header(request, 'x-app-id') ?? apiKey.name ?? 'unknown';
      request.principal = {
        kind: 'api_key',
        tenantId: apiKey.tenantId,
        keyId: apiKey.keyId,
        scopes: apiKey.scopes?.length ? apiKey.scopes : ['chat', 'models'],
        rateLimit: apiKey.rateLimit,
        ...(apiKey.dailyTokenLimit ? { dailyTokenLimit: apiKey.dailyTokenLimit } : {}),
        ...(apiKey.dailySpendLimitUsd ? { dailySpendLimitUsd: apiKey.dailySpendLimitUsd } : {}),
        userId,
        appId,
      };
      request.tenantId = apiKey.tenantId;
      request.userId = userId;
      request.appId = appId;

      // "Last used" is shown to the minute; one write per key per minute per copy instead of one per call.
      const now = Date.now();
      if (now - (lastTouched.get(apiKey.keyId) ?? 0) >= TOUCH_EVERY_MS) {
        lastTouched.set(apiKey.keyId, now);
        if (lastTouched.size > 50_000) lastTouched.delete(lastTouched.keys().next().value as string);
        deps.keys.touchLastUsed(apiKey.tenantId, apiKey.keyId).catch(() => {});
      }
    });

    // Suspended tenants lose access (platform admins keep it, so they can reactivate).
    app.addHook('preHandler', async (request, reply) => {
      const principal = request.principal;
      if (!principal || !deps.tenantStatus) return;
      if (principal.kind === 'user' && principal.role === 'platform_admin') return;
      if ((await deps.tenantStatus(request.tenantId)) === 'suspended') {
        return deny(reply, 403, 'TENANT_SUSPENDED', 'This tenant is suspended');
      }
    });

    // A lapsed license stops AI traffic (keys: apps, IDEs, agents, the browser extension). People can still sign
    // in to the dashboard to renew and to read their evidence.
    app.addHook('preHandler', async (request, reply) => {
      const p = request.principal;
      if (!p || p.kind !== 'api_key' || !deps.licenseStatus) return;
      const status = await deps.licenseStatus(request.tenantId);
      if (status?.state === 'lapsed') return reply.status(403).send(licenseEnded(status));
    });

    // Each key's calls a minute (set when the key is made).
    app.addHook('preHandler', async (request, reply) => {
      const p = request.principal;
      if (!p || p.kind !== 'api_key' || !deps.rate || !p.rateLimit) return;
      const r = await deps.rate.hit(p.tenantId, `key#${p.keyId}`, p.rateLimit);
      reply.header('x-ratelimit-limit', String(r.limit)).header('x-ratelimit-remaining', String(r.remaining));
      if (!r.allowed) {
        return reply.status(429).header('retry-after', String(r.retryAfter))
          .send({ error: `This key may make ${r.limit} calls a minute; try again in ${r.retryAfter} seconds`, code: 'RATE_LIMITED' });
      }
    });

    // Each key's daily caps on tokens and spend, for AI requests (chat and IDE proxy mode).
    app.addHook('preHandler', async (request, reply) => {
      const p = request.principal;
      if (!p || p.kind !== 'api_key') return;
      const caps = { dailyTokenLimit: p.dailyTokenLimit, dailySpendLimitUsd: p.dailySpendLimitUsd };
      if (!hasCaps(caps) || !AI_PATH.test(request.url)) return;
      const refusal = await keySpend().refusal(p.tenantId, p.keyId, caps);
      if (refusal) {
        const now = new Date();
        const retryAfter = Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000);
        return reply.status(429).header('retry-after', String(retryAfter)).send({ error: refusal, code: 'DAILY_LIMIT' });
      }
    });
  });
}

function defaultDeps(): AuthDeps {
  const config = getSecurityConfig();
  let userTokens: UserTokenVerifier | undefined;
  if (config.cognito) {
    const verifier = CognitoJwtVerifier.create({
      userPoolId: config.cognito.userPoolId,
      clientId: config.cognito.clientId,
      tokenUse: 'id',
    });
    userTokens = { verify: async (token) => (await verifier.verify(token)) as unknown as UserTokenClaims };
  } else if (installSignIn()) {
    // A customer-run install: the gateway's own sessions (install/sign-in.ts).
    userTokens = new InstallSessionVerifier();
  }
  if (config.devAuth) logger.warn('AUTH_DEV_MODE is on: `Bearer test-key` is accepted. Never enable this in production.');
  const tenants = tenantSettings();
  return {
    keys: new ApiKeyRepository(),
    userTokens,
    tenantStatus: (tenantId) => tenants.getStatus(tenantId),
    licenseStatus: (tenantId) => licenseState().get(tenantId),
    rate: rateCounter(),
    devAuth: config.devAuth,
    keyCacheTtlMs: config.keyCacheTtlMs,
    signIns: signIns(),
  };
}

/** What a refused request says when the company's license has lapsed. */
export function licenseEnded(status: LicenseStatus) {
  const when = status.graceUntil ? ` on ${status.graceUntil.slice(0, 10)}` : '';
  return {
    error: `Your company’s Probaline license has ended, and AI requests stopped${when}. Ask your administrator to renew it.`,
    code: 'LICENSE_ENDED',
  };
}

export const authMiddleware = fp(async (app: FastifyInstance) => {
  await app.register(createAuthPlugin(defaultDeps()));
});
