import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ApiKeyRepository, hashApiKey } from '../repositories/api-key.repository';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:auth');

// Extend FastifyRequest to carry tenant/user context
declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    userId: string;
    appId: string;
  }
}

const keyRepo = new ApiKeyRepository();

// In-memory cache for validated keys (TTL 60s) to avoid hitting DynamoDB on every request
const keyCache = new Map<string, { tenantId: string; keyId: string; scopes: string[]; rateLimit: number; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

async function authPlugin(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    // Skip health checks, public routes, shadow-ai, and reporting (license-based auth)
    if (request.url.startsWith('/health') || request.url.startsWith('/public') || request.url.startsWith('/v1/shadow-ai') || request.url.startsWith('/v1/reporting')) return;

    const tenantId = request.headers['x-tenant-id'] as string;
    const userId = request.headers['x-user-id'] as string;
    const appId = request.headers['x-app-id'] as string;
    const authHeader = request.headers['authorization'] as string;

    if (!tenantId || !authHeader) {
      return reply.status(401).send({ error: 'Unauthorized', code: 'MISSING_AUTH' });
    }

    // Extract bearer token
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    // Allow legacy "test-key" for development
    if (token === 'test-key' && process.env.STAGE === 'dev') {
      request.tenantId = tenantId;
      request.userId = userId || 'anonymous';
      request.appId = appId || 'unknown';
      return;
    }

    // Validate against API key store
    const keyHash = hashApiKey(token);

    // Check cache first
    const cached = keyCache.get(keyHash);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.tenantId !== tenantId) {
        return reply.status(403).send({ error: 'API key does not belong to this tenant', code: 'TENANT_MISMATCH' });
      }
      request.tenantId = tenantId;
      request.userId = userId || 'anonymous';
      request.appId = appId || 'unknown';
      // Touch last used async (non-blocking)
      keyRepo.touchLastUsed(cached.tenantId, cached.keyId).catch(() => {});
      return;
    }

    // Lookup in DynamoDB
    const apiKey = await keyRepo.findByHash(keyHash);

    if (!apiKey) {
      // If API keys table isn't set up yet, fall through (dev mode)
      if (process.env.STAGE === 'dev') {
        request.tenantId = tenantId;
        request.userId = userId || 'anonymous';
        request.appId = appId || 'unknown';
        return;
      }
      return reply.status(401).send({ error: 'Invalid API key', code: 'INVALID_KEY' });
    }

    if (apiKey.status === 'revoked') {
      return reply.status(401).send({ error: 'API key has been revoked', code: 'KEY_REVOKED' });
    }

    if (apiKey.status === 'expired' || (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date())) {
      return reply.status(401).send({ error: 'API key has expired', code: 'KEY_EXPIRED' });
    }

    if (apiKey.tenantId !== tenantId) {
      return reply.status(403).send({ error: 'API key does not belong to this tenant', code: 'TENANT_MISMATCH' });
    }

    // Cache the validated key
    keyCache.set(keyHash, {
      tenantId: apiKey.tenantId,
      keyId: apiKey.keyId,
      scopes: apiKey.scopes,
      rateLimit: apiKey.rateLimit,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    request.tenantId = tenantId;
    request.userId = userId || 'anonymous';
    request.appId = appId || 'unknown';

    // Touch last used async
    keyRepo.touchLastUsed(apiKey.tenantId, apiKey.keyId).catch(() => {});
  });
}

export const authMiddleware = fp(authPlugin);
