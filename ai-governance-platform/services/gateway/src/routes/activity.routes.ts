import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAccess, TENANT_READ } from '../auth/guards';
import { ACTIVITY_RETENTION_DAYS, activityLog } from '../activity/activity-log';

const query = z.object({
  category: z.enum(['admin', 'sign_in']).optional(),
  outcome: z.enum(['success', 'denied', 'failure']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  after: z.string().max(200).optional(),
});

/** A company's admin activity and sign-ins, newest first. Admins and auditors. */
export async function activityRoutes(app: FastifyInstance) {
  app.get('/activity', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const parsed = query.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid query', code: 'INVALID_QUERY' });
    const q = parsed.data;
    const page = await activityLog().list(request.tenantId, {
      ...q,
      from: q.from ? new Date(q.from).toISOString() : undefined,
      to: q.to ? new Date(q.to).toISOString() : undefined,
    });
    return {
      items: page.items.map(({ ttl: _t, eventKey: _k, ...r }) => r),
      ...(page.next ? { next: page.next } : {}),
      retentionDays: ACTIVITY_RETENTION_DAYS,
    };
  });
}
