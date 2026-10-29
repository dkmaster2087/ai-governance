import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { requireAccess, PLATFORM_ADMIN } from '../auth/guards';
import { queryAuditLogs } from '../services/audit-query';
import { summarizePlatform } from '../services/platform-usage';

const querySchema = z.object({
  days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), 'days must be 7, 30 or 90').default(30),
  tenantId: z.string().min(1).optional(),
  tz: z.coerce.number().int().min(-840).max(840).default(0),
});

/** Records read per tenant per request; beyond this the numbers are marked as lower bounds. */
const MAX_PER_TENANT = 20_000;

export async function platformRoutes(app: FastifyInstance) {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
  const table = process.env.TENANTS_TABLE || 'ai-gov-tenants-dev';

  /** AI traffic per tenant from the audit log, for platform admins. */
  app.get('/platform/usage', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (request) => {
    const q = querySchema.parse(request.query);
    const to = new Date();
    const from = new Date(to.getTime() - q.days * 86_400_000);

    let tenantIds: string[];
    if (q.tenantId) {
      tenantIds = [q.tenantId];
    } else {
      tenantIds = [];
      let lastKey: Record<string, unknown> | undefined;
      do {
        const page = await client.send(new ScanCommand({ TableName: table, ProjectionExpression: 'tenantId', ExclusiveStartKey: lastKey }));
        tenantIds.push(...(page.Items ?? []).map((i) => i.tenantId as string));
        lastKey = page.LastEvaluatedKey;
      } while (lastKey);
    }

    const perTenant = await Promise.all(tenantIds.map(async (tenantId) => {
      const { logs, truncated } = await queryAuditLogs(tenantId, from.toISOString(), to.toISOString(), MAX_PER_TENANT);
      return { tenantId, logs, truncated };
    }));
    return summarizePlatform(perTenant, { from: from.toISOString(), to: to.toISOString(), tz: q.tz });
  });
}
