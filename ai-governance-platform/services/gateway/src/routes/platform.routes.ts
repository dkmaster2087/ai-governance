import { FastifyInstance } from 'fastify';
import { requireAccess, PLATFORM_ADMIN } from '../auth/guards';
import { analyticsClient } from '../clients/analytics.client';

/** AI traffic per tenant, for platform admins, built by the analytics service. */
export async function platformRoutes(app: FastifyInstance) {
  app.get('/platform/usage', { preHandler: requireAccess(PLATFORM_ADMIN) }, (req, reply) => analyticsClient().forward('/internal/v1/platform/usage')(req, reply));
}
