import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { requireAccess, TENANT_READ } from '../auth/guards';
import { queryAuditLogs } from '../services/audit-query';
import { summarizeGatewayTraffic } from '../services/gateway-summary';
import { summarizeStopped } from '../services/stopped-summary';
import { tenantSettings } from '../services/tenant-settings.service';

const logger = createLogger('gateway:summary');
const MAX_RANGE_MS = 31 * 86_400_000;

const rangeSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  /** Viewer's timezone as JS getTimezoneOffset() minutes, for per-day grouping. */
  tz: z.coerce.number().int().min(-840).max(840).optional(),
});

type Range = { fromIso: string; toIso: string; tz: number };

function parseRange(query: unknown): Range | null {
  const parsed = rangeSchema.safeParse(query);
  if (!parsed.success) return null;
  const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
  const from = parsed.data.from ? new Date(parsed.data.from) : new Date(to.getTime() - 7 * 86_400_000);
  if (from >= to || to.getTime() - from.getTime() > MAX_RANGE_MS) return null;
  return { fromIso: from.toISOString(), toIso: to.toISOString(), tz: parsed.data.tz ?? 0 };
}

const INVALID_RANGE = { error: 'from and to must be ISO timestamps, at most 31 days apart', code: 'INVALID_RANGE' };

export async function gatewayRoutes(app: FastifyInstance) {
  /** What happened to the tenant's AI traffic between `from` and `to` (default: the last 7 days). */
  app.get('/gateway/summary', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const range = parseRange(request.query);
    if (!range) return reply.status(400).send(INVALID_RANGE);
    const { fromIso, toIso } = range;

    const { logs, truncated } = await queryAuditLogs(request.tenantId, fromIso, toIso);

    let shadowEvents: Array<{ userId?: string; timestamp?: string }> = [];
    try {
      const page = await collection('shadowAi').query({ partition: request.tenantId, limit: 2000 });
      shadowEvents = (page.items as Array<{ userId?: string; timestamp?: string }>)
        .filter((e) => !!e.timestamp && e.timestamp >= fromIso && e.timestamp <= toIso);
    } catch (err) {
      logger.warn('Shadow AI events unavailable for summary', { tenantId: request.tenantId, error: (err as Error).message });
    }

    const secretsActive = (await tenantSettings().getSecretsAction(request.tenantId)) !== 'off';
    return summarizeGatewayTraffic(logs, { from: fromIso, to: toIso, truncated }, shadowEvents, secretsActive);
  });

  /** Stopped requests in a range, grouped by the rule that stopped them. */
  app.get('/gateway/stopped', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const range = parseRange(request.query);
    if (!range) return reply.status(400).send(INVALID_RANGE);
    const { logs, truncated } = await queryAuditLogs(request.tenantId, range.fromIso, range.toIso);
    const secretsActive = (await tenantSettings().getSecretsAction(request.tenantId)) !== 'off';
    return summarizeStopped(logs, { from: range.fromIso, to: range.toIso, truncated, tzOffsetMinutes: range.tz, secretsActive });
  });
}
