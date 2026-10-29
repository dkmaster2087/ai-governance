import { FastifyInstance } from 'fastify';
import { createLogger } from '@ai-governance/utils';
import { requireAccess, requireTenantParam, TENANT_READ } from '../auth/guards';
import { queryAuditLogs } from '../services/audit-query';

const logger = createLogger('gateway:cost');

export async function costRoutes(app: FastifyInstance) {

  /** Audit records for a tenant within a time range (default: last 30 days), all pages. */
  async function fetchAuditLogs(tenantId: string, from?: string, to?: string) {
    const toIso = to || new Date().toISOString();
    const fromIso = from || new Date(Date.parse(toIso) - 30 * 86_400_000).toISOString();
    try {
      return (await queryAuditLogs(tenantId, fromIso, toIso)).logs;
    } catch (err) {
      logger.error('Failed to query audit logs for cost', { tenantId, error: (err as Error).message });
      throw err;
    }
  }

  // GET /v1/cost/summary/:tenantId
  app.get('/cost/summary/:tenantId', { preHandler: [requireAccess(TENANT_READ), requireTenantParam] }, async (request, reply) => {
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

    // Cost by app
    const costByApp: Record<string, { cost: number; requests: number }> = {};
    for (const log of logs as any[]) {
      const appId = log.appId || 'unknown';
      if (!costByApp[appId]) costByApp[appId] = { cost: 0, requests: 0 };
      costByApp[appId].cost += log.estimatedCost || 0;
      costByApp[appId].requests += 1;
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
      costByApp: Object.entries(costByApp)
        .map(([appId, data]) => ({ appId, ...data }))
        .sort((a, b) => b.cost - a.cost),
      costByUser: Object.entries(costByUser)
        .map(([userId, data]) => ({ userId, ...data }))
        .sort((a, b) => b.cost - a.cost),
    });
  });

  // GET /v1/cost/breakdown/:tenantId
  app.get('/cost/breakdown/:tenantId', { preHandler: [requireAccess(TENANT_READ), requireTenantParam] }, async (request, reply) => {
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
  app.get('/cost/users/:tenantId', { preHandler: [requireAccess(TENANT_READ), requireTenantParam] }, async (request, reply) => {
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
