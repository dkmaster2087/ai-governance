import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { allPages, collection, records, SPECS } from '@ai-governance/storage';
import { AuditLog } from '@ai-governance/types';
import { createLogger, INTERNAL_HEADER, InternalAuthError, InternalCaller, InternalTls, peerService, tlsServerOptions, TrustedKey, verifyInternal } from '@ai-governance/utils';
import { isModelTraffic, queryAuditLogs } from './reports/audit-query';
import { findArchived } from './reports/archive';
import { costBreakdown, costSummary, costUsers, mcpActivity, ruleActivity } from './reports/cost';
import { buildEvidenceRecord, listEvidence } from './reports/evidence';
import { summarizeGatewayTraffic } from './reports/gateway-summary';
import { summarizePlatform } from './reports/platform-usage';
import { ShadowEvent, summarizeShadowAi } from './reports/shadow-ai-summary';
import { summarizeStopped } from './reports/stopped-summary';
import { tenantView } from './reports/tenant';

/**
 * Probaline analytics: every report built from a company's history (traffic summaries, stopped requests,
 * spend, evidence search and case files, shadow AI, rule and MCP activity, and the platform view).
 *
 * It isn't reachable from the internet. The gateway authenticates people, checks what they may see, and
 * forwards the request with a signed internal token naming the company and the user. Analytics trusts only
 * that token: the company always comes from it, never from the address or a header.
 */

const logger = createLogger('analytics');
export const AUDIENCE = 'analytics';
const DAY = 86_400_000;

declare module 'fastify' {
  interface FastifyRequest { caller: InternalCaller }
}

const READ_ROLES = new Set(['tenant_admin', 'tenant_auditor', 'platform_admin']);

const rangeQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  tz: z.coerce.number().int().min(-840).max(840).optional(),
});
const costQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  period: z.enum(['7d', '30d', '90d']).optional(),
});
const evidenceQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  outcome: z.enum(['all', 'stopped', 'cleaned', 'delivered']).optional(),
  q: z.string().max(200).optional(),
  offset: z.coerce.number().int().min(0).max(20_000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const platformQuery = z.object({
  days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), 'days must be 7, 30 or 90').default(30),
  tenantId: z.string().min(1).optional(),
  tz: z.coerce.number().int().min(-840).max(840).default(0),
});

/** Records read per tenant per platform request; beyond this the numbers are marked as lower bounds. */
const MAX_PER_TENANT = 20_000;

/** A range of at most `maxDays`, defaulting to the last `defaultDays`. */
function range(q: { from?: string; to?: string }, defaultDays = 7, maxDays = 31) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - defaultDays * DAY);
  if (from >= to || to.getTime() - from.getTime() > maxDays * DAY) return null;
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

const bad = (reply: FastifyReply, code: string, error: string, status = 400) => reply.status(status).send({ error, code });

export async function buildApp(opts: { trusted: TrustedKey[]; tls?: InternalTls | null }) {
  // With mutual TLS, every connection is encrypted and callers must show a Probaline service certificate.
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024, ...(opts.tls ? { https: tlsServerOptions(opts.tls) } : {}) }) as unknown as FastifyInstance;
  app.decorateRequest('caller', null as unknown as InternalCaller);

  app.get('/health', async () => ({ status: 'healthy', service: 'analytics' }));
  app.get('/health/ready', async (_req, reply) => {
    try { await records().ping(SPECS.auditLogs()); return { status: 'ready' }; } catch (err) {
      return reply.status(503).send({ status: 'degraded', error: (err as Error).message });
    }
  });

  // Every other route: a valid token from the gateway, for a role that may read reports.
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || request.url === '/health/ready') return;
    const peer = opts.tls ? peerService(request.raw.socket) : null;
    if (opts.tls && peer !== 'gateway') {
      logger.warn('Refused an internal request', { error: peer ? `Service ${peer} may not call analytics` : 'No valid service certificate', path: request.url.split('?')[0] });
      return bad(reply, 'UNAUTHENTICATED', 'Analytics only answers the gateway', 401);
    }
    const token = request.headers[INTERNAL_HEADER];
    if (typeof token !== 'string') return bad(reply, 'UNAUTHENTICATED', 'Analytics only answers the gateway', 401);
    try {
      request.caller = verifyInternal(token, opts.trusted, AUDIENCE);
    } catch (err) {
      logger.warn('Refused an internal request', { error: (err as InternalAuthError).message, path: request.url.split('?')[0] });
      return bad(reply, 'UNAUTHENTICATED', 'Analytics only answers the gateway', 401);
    }
    if (!READ_ROLES.has(request.caller.role)) return bad(reply, 'FORBIDDEN', 'This role cannot read reports', 403);
  });

  app.setErrorHandler((error, request, reply) => {
    const err = error as { message?: string; statusCode?: number };
    logger.error('Report failed', { path: request.url.split('?')[0], tenantId: request.caller?.tenantId, error: err.message });
    reply.status(err.statusCode && err.statusCode < 500 ? err.statusCode : 500).send({ error: 'The report could not be built', code: 'REPORT_FAILED' });
  });

  const tenantOf = (request: FastifyRequest) => request.caller.tenantId;
  const parse = <S extends z.ZodTypeAny>(schema: S, request: FastifyRequest, reply: FastifyReply): z.output<S> | null => {
    const r = schema.safeParse(request.query);
    if (!r.success) { bad(reply, 'INVALID_QUERY', r.error.issues[0]?.message ?? 'Invalid query'); return null; }
    return r.data;
  };
  const INVALID_RANGE = 'from and to must be ISO timestamps, at most 31 days apart';

  // ── Traffic ─────────────────────────────────────────────────────────────────────────────────

  app.get('/internal/v1/gateway/summary', async (request, reply) => {
    const q = parse(rangeQuery, request, reply); if (!q) return;
    const r = range(q); if (!r) return bad(reply, 'INVALID_RANGE', INVALID_RANGE);
    const tenantId = tenantOf(request);
    const [{ logs, truncated }, tenant, shadow] = await Promise.all([
      queryAuditLogs(tenantId, r.fromIso, r.toIso), tenantView(tenantId),
      collection('shadowAi').query({ partition: tenantId, limit: 2000 }).then((p) => p.items as Array<{ userId?: string; timestamp?: string }>).catch(() => []),
    ]);
    const shadowEvents = shadow.filter((e) => !!e.timestamp && e.timestamp >= r.fromIso && e.timestamp <= r.toIso);
    return summarizeGatewayTraffic(logs.filter(isModelTraffic), { from: r.fromIso, to: r.toIso, truncated }, shadowEvents, tenant.secretsActive);
  });

  app.get('/internal/v1/gateway/stopped', async (request, reply) => {
    const q = parse(rangeQuery, request, reply); if (!q) return;
    const r = range(q); if (!r) return bad(reply, 'INVALID_RANGE', INVALID_RANGE);
    const tenantId = tenantOf(request);
    const [{ logs, truncated }, tenant] = await Promise.all([queryAuditLogs(tenantId, r.fromIso, r.toIso), tenantView(tenantId)]);
    return summarizeStopped(logs.filter(isModelTraffic), { from: r.fromIso, to: r.toIso, truncated, tzOffsetMinutes: q.tz ?? 0, secretsActive: tenant.secretsActive });
  });

  // ── Spend ───────────────────────────────────────────────────────────────────────────────────

  const costRange = (q: z.infer<typeof costQuery>) => {
    const days = q.period === '7d' ? 7 : q.period === '90d' ? 90 : 30;
    return range(q, days, 93);
  };
  const costLogs = async (tenantId: string, r: { fromIso: string; toIso: string }) => (await queryAuditLogs(tenantId, r.fromIso, r.toIso)).logs.filter(isModelTraffic);
  for (const [path, build] of [
    ['summary', (t: string, logs: AuditLog[], r: { fromIso: string }) => costSummary(t, logs, r.fromIso)],
    ['breakdown', (t: string, logs: AuditLog[]) => costBreakdown(t, logs)],
    ['users', (t: string, logs: AuditLog[]) => costUsers(t, logs)],
  ] as const) {
    app.get(`/internal/v1/cost/${path}`, async (request, reply) => {
      const q = parse(costQuery, request, reply); if (!q) return;
      const r = costRange(q); if (!r) return bad(reply, 'INVALID_RANGE', 'Range must be positive and at most 93 days');
      const tenantId = tenantOf(request);
      return build(tenantId, await costLogs(tenantId, r), r);
    });
  }

  // ── Evidence ────────────────────────────────────────────────────────────────────────────────

  app.get('/internal/v1/evidence', async (request, reply) => {
    const q = parse(evidenceQuery, request, reply); if (!q) return;
    const r = range(q); if (!r) return bad(reply, 'INVALID_RANGE', 'Range must be positive and at most 31 days');
    const { logs, truncated, archived } = await queryAuditLogs(tenantOf(request), r.fromIso, r.toIso);
    return { ...listEvidence(logs, q), truncated, archived, from: r.fromIso, to: r.toIso };
  });

  /**
   * One case file. Keyed by the caller's company, so another company's request ID finds nothing.
   * Past the database window it comes from the archive (slower); `at`, the record's time when known, narrows that.
   */
  app.get('/internal/v1/evidence/:requestId', async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const { at } = request.query as { at?: string };
    const tenantId = tenantOf(request);
    const view = await tenantView(tenantId);
    const item = (await collection<AuditLog & Record<string, unknown>>('auditLogs').get({ tenantId, requestId }))
      ?? await findArchived(tenantId, requestId, view.retentionDays, typeof at === 'string' ? at : undefined);
    if (!item) return bad(reply, 'NOT_FOUND', 'No record for that request', 404);
    return buildEvidenceRecord(item, view.retentionDays, view.legalHold);
  });

  // ── Shadow AI, rules, MCP ───────────────────────────────────────────────────────────────────

  app.get('/internal/v1/shadow-ai/summary', async (request, reply) => {
    const q = parse(rangeQuery, request, reply); if (!q) return;
    const r = range(q); if (!r) return bad(reply, 'INVALID_RANGE', 'Range must be positive and at most 31 days');
    const tenantId = tenantOf(request);
    const [events, tenant] = await Promise.all([
      allPages((after) => collection('shadowAi').query({ partition: tenantId, after, limit: 1000 }), 50_000).catch(() => []) as Promise<unknown[]>,
      tenantView(tenantId),
    ]);
    return summarizeShadowAi(events as ShadowEvent[], tenant.shadowAi, { from: r.fromIso, to: r.toIso });
  });

  /** What each rule did in the last 7 days, for the Rules page. */
  app.get('/internal/v1/rules/activity', async (request) => {
    const r = range({}, 7)!;
    const { logs, truncated } = await queryAuditLogs(tenantOf(request), r.fromIso, r.toIso);
    return { from: r.fromIso, to: r.toIso, truncated, ...ruleActivity(logs) };
  });

  /** Tool calls per MCP server in the last 7 days. */
  app.get('/internal/v1/mcp/activity', async (request) => {
    const r = range({}, 7)!;
    const { logs, truncated } = await queryAuditLogs(tenantOf(request), r.fromIso, r.toIso);
    return { from: r.fromIso, to: r.toIso, truncated, ...mcpActivity(logs) };
  });

  // ── The platform view (Probaline's own operators) ───────────────────────────────────────────

  app.get('/internal/v1/platform/usage', async (request, reply) => {
    if (request.caller.role !== 'platform_admin') return bad(reply, 'FORBIDDEN', 'Platform admins only', 403);
    const q = parse(platformQuery, request, reply); if (!q) return;
    const to = new Date();
    const from = new Date(to.getTime() - q.days * DAY);
    const tenantIds = q.tenantId ? [q.tenantId]
      : (await allPages((after) => collection('tenants').scan({ after, limit: 1000 }))).map((t) => t.tenantId as string);
    const perTenant = await Promise.all(tenantIds.map(async (tenantId) => {
      const { logs, truncated } = await queryAuditLogs(tenantId, from.toISOString(), to.toISOString(), MAX_PER_TENANT);
      return { tenantId, logs: logs.filter(isModelTraffic), truncated };
    }));
    return summarizePlatform(perTenant, { from: from.toISOString(), to: to.toISOString(), tz: q.tz });
  });

  return app;
}
