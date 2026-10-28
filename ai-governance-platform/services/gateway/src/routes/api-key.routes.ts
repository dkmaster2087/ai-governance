import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiKeyRepository, generateApiKey } from '../repositories/api-key.repository';
import { createLogger } from '@ai-governance/utils';
import { requireAccess, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { API_KEY_SCOPES, ApiKeyScope } from '../auth/principal';

const logger = createLogger('gateway:api-key-routes');

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(API_KEY_SCOPES as [ApiKeyScope, ...ApiKeyScope[]])).min(1).optional().default(['chat', 'models']),
  rateLimit: z.number().min(1).max(10000).optional().default(100),
  expiresInDays: z.number().min(1).max(3650).optional(),
});

export async function apiKeyRoutes(app: FastifyInstance) {
  const repo = new ApiKeyRepository();

  /** List all API keys for the tenant (hashes hidden) */
  app.get('/api-keys', { preHandler: requireAccess(TENANT_READ) }, async (request) => {
    const keys = await repo.getForTenant(request.tenantId);
    // Never return the hash — only prefix, name, status, etc.
    return keys.map((k) => ({
      keyId: k.keyId,
      keyPrefix: k.keyPrefix,
      name: k.name,
      scopes: k.scopes,
      status: k.status,
      rateLimit: k.rateLimit,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
      lastUsedAt: k.lastUsedAt,
      createdBy: k.createdBy,
    }));
  });

  /** Generate a new API key */
  app.post('/api-keys', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const body = createKeySchema.parse(request.body);
    // License keys (reporting:ingest) are issued by the platform through /tenants/:tenantId/licenses.
    if (body.scopes.includes('reporting:ingest')) {
      return reply.status(403).send({ error: 'License keys are issued by the platform operator', code: 'FORBIDDEN_SCOPE' });
    }
    const { raw, hash, prefix, keyId } = generateApiKey(request.tenantId);

    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 86400000).toISOString()
      : undefined;

    await repo.create({
      tenantId: request.tenantId,
      keyId,
      keyHash: hash,
      keyPrefix: prefix,
      name: body.name,
      scopes: body.scopes,
      status: 'active',
      rateLimit: body.rateLimit,
      createdAt: new Date().toISOString(),
      expiresAt,
      createdBy: request.userId,
    });

    // Return the raw key ONLY on creation — it's never shown again
    return reply.status(201).send({
      keyId,
      key: raw,
      keyPrefix: prefix,
      name: body.name,
      scopes: body.scopes,
      rateLimit: body.rateLimit,
      expiresAt,
      message: 'Store this key securely. It will not be shown again.',
    });
  });

  /** Revoke an API key */
  app.post('/api-keys/:keyId/revoke', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    await repo.revoke(request.tenantId, keyId);
    return reply.send({ keyId, status: 'revoked' });
  });

  /** Rotate an API key (revoke old, create new with same config) */
  app.post('/api-keys/:keyId/rotate', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { keyId: oldKeyId } = request.params as { keyId: string };
    const keys = await repo.getForTenant(request.tenantId);
    const oldKey = keys.find((k) => k.keyId === oldKeyId);

    if (!oldKey) return reply.status(404).send({ error: 'Key not found' });

    // Revoke old key
    await repo.revoke(request.tenantId, oldKeyId);

    // Generate new key with same config
    const { raw, hash, prefix, keyId: newKeyId } = generateApiKey(request.tenantId);
    await repo.create({
      tenantId: request.tenantId,
      keyId: newKeyId,
      keyHash: hash,
      keyPrefix: prefix,
      name: oldKey.name + ' (rotated)',
      scopes: oldKey.scopes,
      status: 'active',
      rateLimit: oldKey.rateLimit,
      createdAt: new Date().toISOString(),
      expiresAt: oldKey.expiresAt,
      createdBy: request.userId,
    });

    return reply.status(201).send({
      oldKeyId,
      oldStatus: 'revoked',
      newKeyId,
      key: raw,
      keyPrefix: prefix,
      message: 'Old key revoked. Store the new key securely.',
    });
  });

  /** Delete an API key permanently */
  app.delete('/api-keys/:keyId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    await repo.delete(request.tenantId, keyId);
    return reply.send({ keyId, deleted: true });
  });
}
