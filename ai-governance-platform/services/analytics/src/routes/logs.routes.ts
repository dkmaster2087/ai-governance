import { FastifyInstance } from 'fastify';
import { AuditQueryService } from '../services/audit-query.service';

export async function logsRoutes(app: FastifyInstance) {
  const queryService = new AuditQueryService();

  app.get('/:tenantId', async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    const { from, to, userId, limit } = request.query as {
      from?: string;
      to?: string;
      userId?: string;
      limit?: string;
    };
    return queryService.queryLogs({ tenantId, from, to, userId, limit: parseInt(limit || '100') });
  });
}
