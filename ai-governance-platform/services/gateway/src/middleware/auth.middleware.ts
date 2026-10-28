import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { createLogger } from '@ai-governance/utils';
import { ApiKey, ApiKeyRepository, hashApiKey } from '../repositories/api-key.repository';
import { getSecurityConfig } from '../config/security';
import { Principal, isUserRole } from '../auth/principal';
import { tenantSettings } from '../services/tenant-settings.service';

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
const PUBLIC_PREFIXES = ['/health', '/public/'];
/** On-prem agent routes authenticate with the license key in the request body instead. */
const LICENSE_AUTH_ROUTES = ['/v1/reporting/validate-license', '/v1/reporting/ingest'];
const PROXY_PREFIX = '/v1/proxy/';

/** Claims we read from a verified Cognito ID token. */
export interface UserTokenClaims {
  sub: string;
  email?: string;
  'custom:tenantId'?: string;
  'custom:role'?: string;
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
  userTokens?: UserTokenVerifier;
  devAuth: boolean;
  keyCacheTtlMs: number;
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

export function createAuthPlugin(deps: AuthDeps) {
  const keyCache = new Map<string, { key: ApiKey; cachedUntil: number }>();

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
      if (LICENSE_AUTH_ROUTES.includes(path)) return;
      // CORS preflight never carries credentials
      if (request.method === 'OPTIONS') return;

      // In proxy mode the client's Authorization header carries its own provider key and is forwarded
      // untouched, so the Aegis credential travels in x-aegis-key (injected by the corporate proxy).
      const isProxyRoute = request.url.startsWith(PROXY_PREFIX);
      const authHeader = isProxyRoute ? header(request, 'x-aegis-key') : header(request, 'authorization');
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
      if (!apiKey) return deny(reply, 401, 'INVALID_KEY', 'Invalid API key');
      if (apiKey.status === 'revoked') return deny(reply, 401, 'KEY_REVOKED', 'API key has been revoked');
      if (apiKey.status === 'expired' || (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date())) {
        return deny(reply, 401, 'KEY_EXPIRED', 'API key has expired');
      }
      if (requestedTenant && requestedTenant !== apiKey.tenantId) {
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
        userId,
        appId,
      };
      request.tenantId = apiKey.tenantId;
      request.userId = userId;
      request.appId = appId;

      deps.keys.touchLastUsed(apiKey.tenantId, apiKey.keyId).catch(() => {});
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
  }
  if (config.devAuth) logger.warn('AUTH_DEV_MODE is on: `Bearer test-key` is accepted. Never enable this in production.');
  const tenants = tenantSettings();
  return {
    keys: new ApiKeyRepository(),
    userTokens,
    tenantStatus: (tenantId) => tenants.getStatus(tenantId),
    devAuth: config.devAuth,
    keyCacheTtlMs: config.keyCacheTtlMs,
  };
}

export const authMiddleware = fp(async (app: FastifyInstance) => {
  await app.register(createAuthPlugin(defaultDeps()));
});
