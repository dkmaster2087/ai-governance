import { FastifyInstance } from 'fastify';
import { requireAccess, TENANT_READ } from '../auth/guards';
import { analyticsClient } from '../clients/analytics.client';

/** Traffic reports, built by the analytics service. */
export async function gatewayRoutes(app: FastifyInstance) {
  /** What happened to the tenant's AI traffic between `from` and `to` (default: the last 7 days). */
  app.get('/gateway/summary', { preHandler: requireAccess(TENANT_READ) }, (req, reply) => analyticsClient().forward('/internal/v1/gateway/summary')(req, reply));
  /** Stopped requests in a range, grouped by the rule that stopped them. */
  app.get('/gateway/stopped', { preHandler: requireAccess(TENANT_READ) }, (req, reply) => analyticsClient().forward('/internal/v1/gateway/stopped')(req, reply));
}
