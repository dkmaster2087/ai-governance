import { FastifyInstance } from 'fastify';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:cost');

export async function costRoutes(app: FastifyInstance) {
  const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const client = DynamoDBDocumentClient.from(dynamo);
  const auditTable = process.env.AUDIT_LOGS_TABLE || 'ai-gov-audit-logs-dev';

  /** Fetch audit logs for a tenant within a time range */
  async function fetchAuditLogs(tenantId: string, from?: string, to?: string) {
    try {
      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const fromDate = from || defaultFrom;
      const toDate = to || now.toISOString();

      const result = await client.send(
        new QueryCommand({
          TableName: auditTable,
          KeyConditionExpression: 'tenantId = :tid AND #ts BETWEEN :from AND :to',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: {
            ':tid': tenantId,
            ':from': fromDate,
            ':to': toDate,
          },
          IndexName: 'tenantId-timestamp-index',
        })
      );
      return result.Items || [];
    } catch (err) {
      logger.error('Failed to query audit logs for cost', { tenantId, error: err });
      return [];
    }
  }

  // GET /v1/cost/summary/:tenantId
  app.get('/cost/summary/:tenantId', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const { from, to, period } = request.query as { from?: string; to?: string; period?: string };

    // Calculate date range from period
    const now = new Date();
    let fromDate = from;
    if (!fromDate && period) {
      const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
      fromDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    }

    const logs = await fetchAuditLogs(tenantId, fromDate, to);

    const totalCost = logs.reduce((sum: number, l: any) => sum + (l.estimatedCost || 0), 0);
    const days = Math.max(1, Math.ceil((now.getTime() - new Date(fromDate || now.toISOString()).getTime()) / (24 * 60 * 60 * 1000)));
    const dailyAverage = totalCost / days;
    const projectedMonthly = dailyAverage * 30;

    // Cost by model
    const costByModel: Record<string, { cost: number; requests: number }> = {};
    for (const log of logs as any[]) {
      const model = log.modelId || 'unknown';
      if (!costByModel[model]) costByModel[model] = { cost: 0, requests: 0 };
      costByModel[model].cost += log.estimatedCost || 0;
      costByModel[model].requests += 1;
    }

    // Cost by user
    const costByUser: Record<string, { cost: number; requests: number }> = {};
    for (const log of logs as any[]) {
      const user = log.userId || 'unknown';
      if (!costByUser[user]) costByUser[user] = { cost: 0, requests: 0 };
      costByUser[user].cost += log.estimatedCost || 0;
      costByUser[user].requests += 1;
    }

    return reply.send({
      tenantId,
      totalCost,
      dailyAverage,
      projectedMonthly,
      totalRequests: logs.length,
      costByModel: Object.entries(costByModel).map(([modelId, data]) => ({
        modelId,
        ...data,
      })),
      costByUser: Object.entries(costByUser)
        .map(([userId, data]) => ({ userId, ...data }))
        .sort((a, b) => b.cost - a.cost),
    });
  });

  // GET /v1/cost/breakdown/:tenantId
  app.get('/cost/breakdown/:tenantId', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const { from, to, period } = request.query as { from?: string; to?: string; period?: string };

    const now = new Date();
    let fromDate = from;
    if (!fromDate && period) {
      const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
      fromDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    }

    const logs = await fetchAuditLogs(tenantId, fromDate, to);

    // Group by date
    const dailyCost: Record<string, number> = {};
    for (const log of logs as any[]) {
      const date = (log.timestamp || '').slice(0, 10);
      if (!date) continue;
      dailyCost[date] = (dailyCost[date] || 0) + (log.estimatedCost || 0);
    }

    const breakdown = Object.entries(dailyCost)
      .map(([date, cost]) => ({ date, cost }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return reply.send({ tenantId, breakdown });
  });

  // GET /v1/cost/users/:tenantId
  app.get('/cost/users/:tenantId', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const { from, to, period } = request.query as { from?: string; to?: string; period?: string };

    const now = new Date();
    let fromDate = from;
    if (!fromDate && period) {
      const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
      fromDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    }

    const logs = await fetchAuditLogs(tenantId, fromDate, to);

    const userCosts: Record<string, { cost: number; requests: number; inputTokens: number; outputTokens: number }> = {};
    for (const log of logs as any[]) {
      const user = log.userId || 'unknown';
      if (!userCosts[user]) userCosts[user] = { cost: 0, requests: 0, inputTokens: 0, outputTokens: 0 };
      userCosts[user].cost += log.estimatedCost || 0;
      userCosts[user].requests += 1;
      userCosts[user].inputTokens += log.inputTokens || 0;
      userCosts[user].outputTokens += log.outputTokens || 0;
    }

    const users = Object.entries(userCosts)
      .map(([userId, data]) => ({ userId, ...data }))
      .sort((a, b) => b.cost - a.cost);

    return reply.send({ tenantId, users });
  });
}
