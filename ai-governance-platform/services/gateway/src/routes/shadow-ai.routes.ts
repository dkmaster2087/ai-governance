import { FastifyInstance } from 'fastify';
import { alerting } from '../services/alerting.service';
import { allPages, collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { z } from 'zod';
import { requireAccess, requireTenantParam, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { ShadowAiPolicyStore, applyPolicyChange, extensionConfig } from '../services/shadow-ai-policy';
import { analyticsClient } from '../clients/analytics.client';

const logger = createLogger('gateway:shadow-ai');

interface ShadowAIEvent {
  id: string;
  timestamp: string;
  domain: string;
  type?: string;
  method?: string;
  blocked: boolean;
  tenantId: string;
  source?: string;
  userId?: string;
}

const eventsBodySchema = z.object({
  tenantId: z.string().optional(),
  events: z.array(z.object({
    id: z.string().max(128).optional(),
    timestamp: z.string().max(64).optional(),
    domain: z.string().min(1).max(255),
    // Older extension versions send the full address; it is accepted and discarded, never stored.
    url: z.string().max(2048).optional(),
    type: z.string().max(64).optional(),
    /** Where the sighting came from: the browser extension today, log connectors later. */
    source: z.string().max(64).regex(/^[a-z0-9_:-]+$/).optional(),
    method: z.string().max(32).optional(),
    blocked: z.boolean(),
    userId: z.string().max(256).optional(),
  })).min(1).max(500),
});

const policyChangeSchema = z.object({
  mode: z.enum(['monitor', 'block']).optional(),
  decisions: z.record(z.string().max(300), z.enum(['blocked', 'allowed']).nullable()).optional(),
  guidance: z.object({
    message: z.string().max(300).optional(),
    links: z.array(z.object({ name: z.string().max(60), url: z.string().max(500) })).max(10).optional(),
  }).optional(),
});


export async function shadowAIRoutes(app: FastifyInstance) {
  const shadow = () => collection('shadowAi');

  // Receive events from the browser extension. The tenant comes from the extension's API key.
  app.post('/shadow-ai/events', { preHandler: requireAccess({ scopes: ['shadow_ai:ingest'] }) }, async (request, reply) => {
    const parsed = eventsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid events payload', code: 'INVALID_EVENTS', issues: parsed.error.issues });
    }
    const { tenantId: bodyTenantId, events } = parsed.data;
    const tenantId = request.tenantId;
    if (bodyTenantId && bodyTenantId !== tenantId) {
      return reply.status(403).send({ error: 'API key does not belong to this tenant', code: 'TENANT_MISMATCH' });
    }

    logger.info('Receiving shadow AI events', { tenantId, count: events.length });

    let stored = 0;
    for (const evt of events) {
      try {
        await shadow().put({
            tenantId,
            eventId: evt.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: evt.timestamp || new Date().toISOString(),
            domain: evt.domain.toLowerCase(),
            type: evt.type || 'unknown',
            source: evt.source || 'browser_extension',
            method: evt.method || 'BROWSER',
            blocked: evt.blocked,
            userId: evt.userId || 'unknown',
            ttl: Math.floor(Date.now() / 1000) + 30 * 86400, // 30 day TTL
        });
        stored++;
      } catch (err) {
        logger.warn('Failed to store shadow AI event', { error: err });
      }
    }

    alerting().signal(() => alerting().fromShadowAi(tenantId, stored));
    return reply.status(200).send({ received: events.length, stored });
  });

  const policies = new ShadowAiPolicyStore();

  // What the browser extension should watch and block, for the tenant its API key belongs to.
  app.get('/shadow-ai/config', { preHandler: requireAccess({ roles: ['tenant_admin', 'tenant_auditor'], scopes: ['shadow_ai:ingest'] }) }, async (request) =>
    extensionConfig(request.tenantId, await policies.get(request.tenantId)));

  // Same, by tenant ID (older extension versions).
  app.get('/shadow-ai/config/:tenantId', { preHandler: [requireAccess({ roles: ['tenant_admin', 'tenant_auditor'], scopes: ['shadow_ai:ingest'] }), requireTenantParam] }, async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    return extensionConfig(tenantId, await policies.get(tenantId));
  });

  app.get('/shadow-ai/policy', { preHandler: requireAccess(TENANT_READ) }, async (request) => policies.get(request.tenantId));

  app.put('/shadow-ai/policy', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = policyChangeSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid change', code: 'INVALID_POLICY', issues: parsed.error.issues });
    const result = applyPolicyChange(await policies.get(request.tenantId), parsed.data);
    if ('error' in result) return reply.status(400).send({ error: result.error, code: 'INVALID_POLICY' });
    await policies.save(request.tenantId, result.policy);
    logger.info('Shadow AI policy updated', { tenantId: request.tenantId, by: request.userId, change: parsed.data });
    return result.policy;
  });

  // Visits to AI tools outside the gateway, grouped by tool: built by the analytics service.
  app.get('/shadow-ai/summary', { preHandler: requireAccess(TENANT_READ) }, (req, reply) => analyticsClient().forward('/internal/v1/shadow-ai/summary')(req, reply));
}
