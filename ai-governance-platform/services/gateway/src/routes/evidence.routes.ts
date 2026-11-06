import { FastifyInstance } from 'fastify';
import { createLogger } from '@ai-governance/utils';
import { requireAccess, TENANT_READ } from '../auth/guards';
import { ANALYTICS_UNAVAILABLE, AnalyticsClient, analyticsClient, AnalyticsUnavailableError } from '../clients/analytics.client';

const logger = createLogger('gateway:evidence');

/** Case files, searched and built by the analytics service. */
export async function evidenceRoutes(app: FastifyInstance) {
  /** Every decision in a range, newest first, filtered by outcome and free-text search. */
  app.get('/evidence', { preHandler: requireAccess(TENANT_READ) }, (req, reply) => analyticsClient().forward('/internal/v1/evidence')(req, reply));

  app.get('/evidence/:requestId', { preHandler: requireAccess(TENANT_READ) }, (req, reply) =>
    analyticsClient().forward((r) => `/internal/v1/evidence/${encodeURIComponent((r.params as { requestId: string }).requestId)}`)(req, reply));

  /** The case file as a downloadable JSON document, for auditors. */
  app.get('/evidence/:requestId/export', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    let answer;
    try {
      answer = await analyticsClient().get(`/internal/v1/evidence/${encodeURIComponent(requestId)}`, AnalyticsClient.callerOf(request));
    } catch (err) {
      if (err instanceof AnalyticsUnavailableError) return reply.status(503).send(ANALYTICS_UNAVAILABLE);
      throw err;
    }
    if (answer.status !== 200) return reply.status(answer.status).send(answer.body);
    logger.info('Evidence exported', { tenantId: request.tenantId, requestId, by: request.userId });
    const doc = { exportedAt: new Date().toISOString(), exportedBy: request.userId, tenantId: request.tenantId, record: answer.body };
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="probaline-evidence-${requestId.replace(/[^a-zA-Z0-9-]/g, '')}.json"`)
      .send(JSON.stringify(doc, null, 2));
  });
}
