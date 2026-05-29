import { FastifyInstance } from 'fastify';
import { metrics } from '../services/metrics';

export async function metricsRoutes(app: FastifyInstance) {
  /** Get current metrics snapshot (for CloudWatch agent or Prometheus scraping) */
  app.get('/metrics', async () => {
    return {
      timestamp: new Date().toISOString(),
      ...metrics.getSnapshot(),
    };
  });

  /** Reset metrics (for testing) */
  app.post('/metrics/reset', async () => {
    metrics.reset();
    return { reset: true };
  });
}
