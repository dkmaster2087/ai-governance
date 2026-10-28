import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AlertingService, AlertType, AlertSeverity, AlertChannel } from '../services/alerting.service';
import { randomUUID } from 'crypto';
import { requireAccess, TENANT_ADMIN, TENANT_READ } from '../auth/guards';

const createRuleSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['budget_threshold', 'policy_violation_spike', 'license_expiry', 'shadow_ai_activity', 'service_unhealthy', 'pii_leakage']),
  severity: z.enum(['info', 'warning', 'critical']).optional().default('warning'),
  channel: z.enum(['webhook', 'email']).optional().default('webhook'),
  destination: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  config: z.record(z.any()).optional().default({}),
});

export async function alertRoutes(app: FastifyInstance) {
  const alerting = new AlertingService();

  /** List alert rules for tenant */
  app.get('/alerts/rules', { preHandler: requireAccess(TENANT_READ) }, async (request) => {
    return alerting.getRules(request.tenantId);
  });

  /** Create a new alert rule */
  app.post('/alerts/rules', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const body = createRuleSchema.parse(request.body);
    const rule = {
      ruleId: `alert_${randomUUID().slice(0, 8)}`,
      tenantId: request.tenantId,
      name: body.name,
      type: body.type as AlertType,
      severity: body.severity as AlertSeverity,
      channel: body.channel as AlertChannel,
      destination: body.destination,
      enabled: body.enabled,
      config: body.config,
      createdAt: new Date().toISOString(),
      triggerCount: 0,
    };
    await alerting.createRule(rule);
    return reply.status(201).send(rule);
  });

  /** Get default rules template */
  app.get('/alerts/defaults', { preHandler: requireAccess(TENANT_READ) }, async (request) => {
    return alerting.getDefaultRules(request.tenantId, 'https://your-webhook-url.com/alerts');
  });

  /** Manually trigger a test alert */
  app.post('/alerts/test', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const body = request.body as any;
    const event = await alerting.trigger(request.tenantId, body.type || 'budget_threshold', {
      title: body.title || 'Test Alert',
      message: body.message || 'This is a test alert from Aegis AI',
      severity: body.severity || 'info',
      metadata: { test: true },
    });
    return reply.send({ triggered: !!event, event });
  });
}
