import { FastifyInstance } from 'fastify';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createLogger } from '@ai-governance/utils';
import { z } from 'zod';
import { requireAccess, requireTenantParam, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { ShadowAiPolicyStore, applyPolicyChange, extensionConfig } from '../services/shadow-ai-policy';
import { ShadowEvent, summarizeShadowAi } from '../services/shadow-ai-summary';

const logger = createLogger('gateway:shadow-ai');

interface ShadowAIEvent {
  id: string;
  timestamp: string;
  domain: string;
  url?: string;
  type?: string;
  method?: string;
  blocked: boolean;
  tenantId: string;
  userId?: string;
}

const eventsBodySchema = z.object({
  tenantId: z.string().optional(),
  events: z.array(z.object({
    id: z.string().max(128).optional(),
    timestamp: z.string().max(64).optional(),
    domain: z.string().min(1).max(255),
    url: z.string().max(2048).optional(),
    type: z.string().max(64).optional(),
    method: z.string().max(32).optional(),
    blocked: z.boolean(),
    userId: z.string().max(256).optional(),
  })).min(1).max(500),
});

const policyChangeSchema = z.object({
  mode: z.enum(['monitor', 'block']).optional(),
  decisions: z.record(z.string().max(300), z.enum(['blocked', 'allowed']).nullable()).optional(),
});

const summaryRangeSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export async function shadowAIRoutes(app: FastifyInstance) {
  const dynamo = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
  );
  const table = process.env.SHADOW_AI_TABLE || 'ai-gov-shadow-ai-dev';

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
        await dynamo.send(new PutCommand({
          TableName: table,
          Item: {
            tenantId,
            eventId: evt.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: evt.timestamp || new Date().toISOString(),
            domain: evt.domain,
            url: evt.url,
            type: evt.type || 'unknown',
            method: evt.method || 'BROWSER',
            blocked: evt.blocked,
            userId: evt.userId || 'unknown',
            ttl: Math.floor(Date.now() / 1000) + 30 * 86400, // 30 day TTL
          },
        }));
        stored++;
      } catch (err) {
        logger.warn('Failed to store shadow AI event', { error: err });
      }
    }

    return reply.status(200).send({ received: events.length, stored });
  });

  const policies = new ShadowAiPolicyStore();

  // What the browser extension should watch and block, from the tenant's decisions.
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

  // Visits to AI tools outside the gateway, grouped by tool, for the dashboard.
  app.get('/shadow-ai/summary', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const parsed = summaryRangeSchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'from and to must be ISO timestamps', code: 'INVALID_RANGE' });
    const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
    const from = parsed.data.from ? new Date(parsed.data.from) : new Date(to.getTime() - 7 * 86_400_000);
    if (from >= to || to.getTime() - from.getTime() > 31 * 86_400_000) {
      return reply.status(400).send({ error: 'Range must be positive and at most 31 days', code: 'INVALID_RANGE' });
    }
    const [events, policy] = await Promise.all([readAllEvents(request.tenantId), policies.get(request.tenantId)]);
    return summarizeShadowAi(events, policy, { from: from.toISOString(), to: to.toISOString() });
  });

  /** All stored events for a tenant (kept 30 days), following pagination with a safety cap. */
  async function readAllEvents(tenantId: string): Promise<ShadowEvent[]> {
    const out: ShadowEvent[] = [];
    let lastKey: Record<string, unknown> | undefined;
    try {
      do {
        const page = await dynamo.send(new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'tenantId = :tid',
          ExpressionAttributeValues: { ':tid': tenantId },
          ExclusiveStartKey: lastKey,
        }));
        out.push(...((page.Items ?? []) as ShadowEvent[]));
        lastKey = page.LastEvaluatedKey;
      } while (lastKey && out.length < 50_000);
    } catch (err) {
      logger.warn('Shadow AI table not available', { tenantId, error: (err as Error).message });
    }
    return out;
  }

  // Get aggregated shadow AI data for dashboard
  app.get('/shadow-ai/data/:tenantId', { preHandler: [requireAccess(TENANT_READ), requireTenantParam] }, async (request) => {
    const { tenantId } = request.params as { tenantId: string };

    let events: ShadowAIEvent[] = [];
    try {
      const result = await dynamo.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'tenantId = :tid',
        ExpressionAttributeValues: { ':tid': tenantId },
        ScanIndexForward: false,
        Limit: 500,
      }));
      events = (result.Items || []) as ShadowAIEvent[];
    } catch (err) {
      logger.warn('Shadow AI table not available, returning empty', { tenantId });
    }

    // Aggregate
    const now = Date.now();
    const last7d = events.filter((e) => now - new Date(e.timestamp).getTime() < 7 * 86400000);

    const uniqueUsers = new Set(last7d.map((e) => e.userId || 'unknown'));
    const blockedEndpoints = [...new Set(last7d.filter((e) => e.blocked).map((e) => e.domain))];

    // By day
    const byDay: Record<string, number> = {};
    for (const e of last7d) {
      const day = e.timestamp.slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
    }
    const bypassAttempts = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([date, attempts]) => ({ date: date.slice(5), attempts }));

    // By endpoint
    const byEndpoint: Record<string, number> = {};
    for (const e of last7d) byEndpoint[e.domain] = (byEndpoint[e.domain] || 0) + 1;
    const total = last7d.length || 1;
    const endpointBreakdown = Object.entries(byEndpoint)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([endpoint, attempts]) => ({ endpoint, attempts, percentage: Math.round((attempts / total) * 100) }));

    // Top users
    const byUser: Record<string, { attempts: number; lastSeen: string; endpoints: Set<string> }> = {};
    for (const e of last7d) {
      const uid = e.userId || 'unknown';
      if (!byUser[uid]) byUser[uid] = { attempts: 0, lastSeen: e.timestamp, endpoints: new Set() };
      byUser[uid].attempts++;
      byUser[uid].endpoints.add(e.domain);
      if (e.timestamp > byUser[uid].lastSeen) byUser[uid].lastSeen = e.timestamp;
    }
    const topBypassUsers = Object.entries(byUser)
      .sort(([, a], [, b]) => b.attempts - a.attempts)
      .slice(0, 10)
      .map(([userId, d]) => ({ userId, department: 'Unknown', attempts: d.attempts, lastSeen: d.lastSeen, endpoints: [...d.endpoints] }));

    // Risk score
    const riskScore = Math.min(100, Math.round(
      (last7d.length * 2) + (uniqueUsers.size * 5) + (blockedEndpoints.length * 10)
    ));

    // Recent events
    const recentEvents = last7d.slice(0, 20).map((e) => ({
      id: (e as any).eventId || e.id,
      userId: e.userId || 'unknown',
      endpoint: e.domain,
      method: e.method || 'BROWSER',
      timestamp: e.timestamp,
      blocked: e.blocked,
    }));

    return {
      summary: {
        totalBypassAttempts: last7d.length,
        uniqueUsers: uniqueUsers.size,
        blockedEndpoints,
        riskScore,
        trend: last7d.length > 0 ? `+${last7d.length}` : '0',
      },
      bypassAttempts,
      topBypassUsers,
      endpointBreakdown,
      recentEvents,
    };
  });
}
