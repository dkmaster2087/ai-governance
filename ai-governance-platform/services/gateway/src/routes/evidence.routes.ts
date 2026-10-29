import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { AuditLog } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { requireAccess, TENANT_READ } from '../auth/guards';
import { queryAuditLogs } from '../services/audit-query';
import { buildEvidenceRecord, listEvidence } from '../services/evidence';
import { tenantSettings } from '../services/tenant-settings.service';

const logger = createLogger('gateway:evidence');
const DEFAULT_RETENTION_DAYS = 365;

const listQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  outcome: z.enum(['all', 'stopped', 'cleaned', 'delivered']).optional(),
  q: z.string().max(200).optional(),
  offset: z.coerce.number().int().min(0).max(20_000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function evidenceRoutes(app: FastifyInstance) {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
  const auditTable = process.env.AUDIT_LOGS_TABLE || 'ai-gov-audit-logs-dev';

  async function loadRecord(tenantId: string, requestId: string) {
    // Keyed by the caller's tenant, so another tenant's request ID finds nothing.
    const result = await client.send(new GetCommand({ TableName: auditTable, Key: { tenantId, requestId } }));
    if (!result.Item) return null;
    const retention = (await tenantSettings().getSettings(tenantId))?.auditLogRetentionDays ?? DEFAULT_RETENTION_DAYS;
    return buildEvidenceRecord(result.Item as AuditLog, retention);
  }

  /** Every decision in a range, newest first, filtered by outcome and free-text search. */
  app.get('/evidence', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', code: 'INVALID_QUERY' });
    const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
    const from = parsed.data.from ? new Date(parsed.data.from) : new Date(to.getTime() - 7 * 86_400_000);
    if (from >= to || to.getTime() - from.getTime() > 31 * 86_400_000) {
      return reply.status(400).send({ error: 'Range must be positive and at most 31 days', code: 'INVALID_RANGE' });
    }
    const { logs, truncated } = await queryAuditLogs(request.tenantId, from.toISOString(), to.toISOString());
    return { ...listEvidence(logs, parsed.data), truncated, from: from.toISOString(), to: to.toISOString() };
  });

  app.get('/evidence/:requestId', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const record = await loadRecord(request.tenantId, requestId);
    if (!record) return reply.status(404).send({ error: 'No record for that request', code: 'NOT_FOUND' });
    return record;
  });

  /** The case file as a downloadable JSON document, for auditors. */
  app.get('/evidence/:requestId/export', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const record = await loadRecord(request.tenantId, requestId);
    if (!record) return reply.status(404).send({ error: 'No record for that request', code: 'NOT_FOUND' });
    logger.info('Evidence exported', { tenantId: request.tenantId, requestId, by: request.userId });
    const doc = { exportedAt: new Date().toISOString(), exportedBy: request.userId, tenantId: request.tenantId, record };
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="aegis-evidence-${requestId.replace(/[^a-zA-Z0-9-]/g, '')}.json"`)
      .send(JSON.stringify(doc, null, 2));
  });
}
