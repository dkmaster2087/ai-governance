import { FastifyInstance } from 'fastify';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createLogger } from '@ai-governance/utils';

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

export async function shadowAIRoutes(app: FastifyInstance) {
  const dynamo = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
  );
  const table = process.env.SHADOW_AI_TABLE || 'ai-gov-shadow-ai-dev';

  // Receive events from browser extension
  app.post('/shadow-ai/events', async (request, reply) => {
    const { tenantId, events } = request.body as { tenantId: string; events: ShadowAIEvent[] };
    if (!tenantId || !events?.length) {
      return reply.status(400).send({ error: 'tenantId and events required' });
    }

    logger.info('Receiving shadow AI events', { tenantId, count: events.length });

    // Store each event
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
      } catch (err) {
        logger.warn('Failed to store shadow AI event', { error: err });
      }
    }

    return reply.status(200).send({ received: events.length });
  });

  // Get shadow AI config for a tenant (used by extension)
  app.get('/shadow-ai/config/:tenantId', async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    // In production this would come from a config table
    // For now return defaults that the extension can override
    return {
      tenantId,
      mode: 'monitor',
      blockedDomains: [
        'api.openai.com', 'chat.openai.com', 'chatgpt.com',
        'api.anthropic.com', 'claude.ai',
        'bard.google.com', 'gemini.google.com',
        'perplexity.ai', 'copilot.microsoft.com',
        'deepseek.com', 'chat.deepseek.com',
      ],
      allowedDomains: [],
    };
  });

  // Get aggregated shadow AI data for dashboard
  app.get('/shadow-ai/data/:tenantId', async (request) => {
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
