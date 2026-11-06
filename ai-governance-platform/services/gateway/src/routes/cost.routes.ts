import { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAccess, requireTenantParam, TENANT_READ } from '../auth/guards';
import { analyticsClient } from '../clients/analytics.client';

/** Spend reports, built by the analytics service. The tenant in the address was checked by requireTenantParam. */
export async function costRoutes(app: FastifyInstance) {
  const tenantFrom = (req: FastifyRequest) => (req.params as { tenantId: string }).tenantId;
  for (const view of ['summary', 'breakdown', 'users'] as const) {
    app.get(`/cost/${view}/:tenantId`, { preHandler: [requireAccess(TENANT_READ), requireTenantParam] },
      (req, reply) => analyticsClient().forward(`/internal/v1/cost/${view}`, { tenantFrom })(req, reply));
  }
}
