import { FastifyInstance } from 'fastify';
import { metrics } from '../services/metrics';
import { requireAccess, PLATFORM_ADMIN } from '../auth/guards';

export async function metricsRoutes(app: FastifyInstance) {
  /** Get current metrics snapshot (for CloudWatch agent or Prometheus scraping) */
  app.get('/metrics', { preHandler: requireAccess(PLATFORM_ADMIN) }, async () => {
    return {
      timestamp: new Date().toISOString(),
      ...metrics.getSnapshot(),
    };
  });

  /** Reset metrics (for testing) */
  app.post('/metrics/reset', { preHandler: requireAccess(PLATFORM_ADMIN) }, async () => {
    metrics.reset();
    return { reset: true };
  });
}
