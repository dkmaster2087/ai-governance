import { FastifyInstance } from 'fastify';
import { MetricsService } from '../services/metrics.service';

export async function metricsRoutes(app: FastifyInstance) {
  const metricsService = new MetricsService();

  // Usage summary for a tenant
  app.get('/:tenantId/summary', async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    const { period } = request.query as { period?: string };
    return metricsService.getSummary(tenantId, period || '7d');
  });

  // Cost breakdown
  app.get('/:tenantId/cost', async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    const { from, to } = request.query as { from?: string; to?: string };
    return metricsService.getCostBreakdown(tenantId, from, to);
  });

  // Model usage distribution
  app.get('/:tenantId/models', async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    return metricsService.getModelDistribution(tenantId);
  });

  // Policy violations over time
  app.get('/:tenantId/violations', async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    return metricsService.getViolations(tenantId);
  });
}
