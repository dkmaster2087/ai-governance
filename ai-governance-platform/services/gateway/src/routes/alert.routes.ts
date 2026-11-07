import { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAccess, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { AnalyticsClient, analyticsClient } from '../clients/analytics.client';
import { DestinationError, checkDestinationUrl } from '../log-export/destinations';
import {
  ALERT_KINDS, AlertRule, alerting, DEFAULTS, describeRule, MAX_EMAILS, MAX_RULES, newAlertId, newSigningSecret, ruleView,
} from '../services/alerting.service';

const config = z.object({
  count: z.number().int().min(1).max(100_000).optional(),
  minutes: z.number().int().min(5).max(1440).optional(),
  monthlyBudgetUSD: z.number().positive().max(100_000_000).optional(),
  percent: z.number().int().min(1).max(1000).optional(),
}).strict();

const base = {
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  config,
  emails: z.array(z.string().trim().toLowerCase().email().max(254)).max(MAX_EMAILS),
  webhookUrl: z.string().trim().max(2000).nullable(),
};
const createSchema = z.object({ ...base, kind: z.enum(ALERT_KINDS) }).partial({ enabled: true, config: true, emails: true, webhookUrl: true }).strict();
const changeSchema = z.object(base).partial().strict();

const bad = (reply: FastifyReply, code: string, error: string, status = 400) => reply.status(status).send({ error, code });

/** A rule needs somewhere to go, and a webhook address that passes the same checks as log export. */
function checkDelivery(emails: string[], webhookUrl: string | null | undefined): string | null {
  if (!emails.length && !webhookUrl) return 'Add at least one email address or a webhook';
  if (webhookUrl) {
    try { checkDestinationUrl(webhookUrl); } catch (err) { return err instanceof DestinationError ? err.message : 'That isn’t a valid address'; }
  }
  return null;
}

/**
 * Alerts (dashboard → Alerts). Company admins manage them; auditors can look. Changes are recorded as admin
 * activity by the shared hook.
 */
export async function alertRoutes(app: FastifyInstance) {
  app.get('/alerts/rules', { preHandler: requireAccess(TENANT_READ) }, async (request) =>
    (await alerting().rules(request.tenantId)).map(ruleView));

  app.get('/alerts/events', { preHandler: requireAccess(TENANT_READ) }, async (request) => {
    const limit = Math.min(200, Math.max(1, Number((request.query as { limit?: string }).limit) || 50));
    return alerting().events(request.tenantId, limit);
  });

  app.post('/alerts/rules', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, 'INVALID_ALERT', parsed.error.issues.map((i) => `${i.path.join('.') || 'alert'}: ${i.message}`).join('; '));
    const b = parsed.data;
    const existing = await alerting().rules(request.tenantId);
    if (existing.length >= MAX_RULES) return bad(reply, 'TOO_MANY_ALERTS', `A company can have ${MAX_RULES} alerts`);
    const emails = [...new Set(b.emails ?? [])];
    const problem = checkDelivery(emails, b.webhookUrl);
    if (problem) return bad(reply, 'INVALID_ALERT', problem);
    if (b.kind === 'spend' && !b.config?.monthlyBudgetUSD) return bad(reply, 'INVALID_ALERT', 'Set the monthly budget');
    const now = new Date().toISOString();
    const rule: AlertRule = {
      tenantId: request.tenantId, ruleId: newAlertId(), name: b.name, kind: b.kind, enabled: b.enabled ?? true,
      config: { ...DEFAULTS[b.kind], ...(b.config ?? {}) }, emails,
      ...(b.webhookUrl ? { webhookUrl: b.webhookUrl, signingSecret: newSigningSecret() } : {}),
      createdAt: now, createdBy: request.userId, updatedAt: now, firedCount: 0,
    };
    await alerting().save(rule);
    // A spend alert made mid-month starts from what was already spent (when analytics can say).
    if (rule.kind === 'spend') {
      const from = `${now.slice(0, 7)}-01T00:00:00.000Z`;
      const spent = await analyticsClient().optional<{ totalCost?: number }>(
        `/internal/v1/cost/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(now)}`, AnalyticsClient.callerOf(request)).catch(() => null);
      if (spent?.totalCost) await alerting().seedSpend(request.tenantId, spent.totalCost);
    }
    // The signing secret is shown this once.
    return reply.status(201).send({ ...ruleView(rule), ...(rule.signingSecret ? { signingSecret: rule.signingSecret } : {}) });
  });

  app.patch('/alerts/rules/:ruleId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { ruleId } = request.params as { ruleId: string };
    const rule = await alerting().rule(request.tenantId, ruleId);
    if (!rule) return bad(reply, 'NOT_FOUND', 'Alert not found', 404);
    const parsed = changeSchema.safeParse(request.body);
    if (!parsed.success) return bad(reply, 'INVALID_ALERT', parsed.error.issues.map((i) => `${i.path.join('.') || 'alert'}: ${i.message}`).join('; '));
    const c = parsed.data;
    const emails = c.emails ? [...new Set(c.emails)] : rule.emails;
    const webhookUrl = c.webhookUrl === undefined ? rule.webhookUrl : c.webhookUrl ?? undefined;
    const problem = checkDelivery(emails, webhookUrl);
    if (problem) return bad(reply, 'INVALID_ALERT', problem);
    const next: AlertRule = {
      ...rule, ...(c.name ? { name: c.name } : {}), ...(c.enabled !== undefined ? { enabled: c.enabled } : {}),
      config: { ...rule.config, ...(c.config ?? {}) }, emails, updatedAt: new Date().toISOString(),
    };
    let newSecret: string | undefined;
    if (webhookUrl !== rule.webhookUrl) {
      delete next.webhookUrl; delete next.signingSecret;
      if (webhookUrl) { next.webhookUrl = webhookUrl; next.signingSecret = newSecret = newSigningSecret(); }
    }
    await alerting().save(next);
    return { ...ruleView(next), ...(newSecret ? { signingSecret: newSecret } : {}) };
  });

  app.delete('/alerts/rules/:ruleId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { ruleId } = request.params as { ruleId: string };
    if (!(await alerting().rule(request.tenantId, ruleId))) return bad(reply, 'NOT_FOUND', 'Alert not found', 404);
    await alerting().remove(request.tenantId, ruleId);
    return reply.status(204).send();
  });

  /** Sends a test alert to the rule's people and webhook now, and says what happened. */
  app.post('/alerts/rules/:ruleId/test', { preHandler: requireAccess(TENANT_ADMIN), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { ruleId } = request.params as { ruleId: string };
    const rule = await alerting().rule(request.tenantId, ruleId);
    if (!rule) return bad(reply, 'NOT_FOUND', 'Alert not found', 404);
    const event = await alerting().fire(rule, `Test: ${rule.name}`, `This is a test. The real alert is sent when: ${describeRule(rule)}.`, true);
    return { delivery: event.delivery };
  });
}
