import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { requireAccess, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { PolicyAdminClient } from '../clients/policy-admin.client';
import { AnalyticsClient, analyticsClient } from '../clients/analytics.client';
import { applyRuleChange, buildRuleViews, newRule, PII_TYPES, RuleActivity } from '../services/rules';
import { tenantSettings } from '../services/tenant-settings.service';
import { getSecurityConfig } from '../config/security';

const logger = createLogger('gateway:rules');
const CUSTOM_POLICY_NAME = 'Custom rules';

const values = z.array(z.string().trim().min(1).max(200)).min(1).max(50);
const ruleInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('keyword_block'), description: z.string().trim().min(1).max(200), values }),
  z.object({ type: z.literal('model_restriction'), description: z.string().trim().min(1).max(200), values }),
  z.object({ type: z.literal('data_classification'), description: z.string().trim().min(1).max(200), values }),
  z.object({ type: z.literal('pii_detection'), description: z.string().trim().min(1).max(200), values: z.array(z.enum(PII_TYPES as [string, ...string[]])).min(1) }),
]);
const ruleChange = z.object({
  enabled: z.boolean().optional(),
  description: z.string().trim().min(1).max(200).optional(),
  values: values.optional(),
}).refine((c) => Object.keys(c).length > 0, 'Nothing to change');

export async function rulesRoutes(app: FastifyInstance) {
  const engine = new PolicyAdminClient();

  /** Every rule for the tenant, what it did in the last 7 days, and the gateway's fail mode. */
  /** The rules come from the policy engine; what they did comes from analytics, and the page still loads without it. */
  app.get('/rules', { preHandler: requireAccess(TENANT_READ) }, async (request) => {
    type Activity = { from: string; to: string; rules: RuleActivity; secrets: { stopped: number; redacted: number }; cleaned: number };
    const [policies, activity, failMode, secretsAction] = await Promise.all([
      engine.list(request.tenantId),
      analyticsClient().optional<Activity>('/internal/v1/rules/activity', AnalyticsClient.callerOf(request)),
      tenantSettings().getFailMode(request.tenantId),
      tenantSettings().getSecretsAction(request.tenantId),
    ]);
    const to = new Date();
    return {
      from: activity?.from ?? new Date(to.getTime() - 7 * 86_400_000).toISOString(),
      to: activity?.to ?? to.toISOString(),
      failMode,
      ...(activity ? {} : { activityUnavailable: true }),
      secrets: { action: secretsAction, stopped: activity?.secrets.stopped ?? 0, redacted: activity?.secrets.redacted ?? 0 },
      cleaned: activity?.cleaned ?? 0,
      piiTypes: PII_TYPES,
      rules: buildRuleViews(policies, activity?.rules),
    };
  });

  /** Add a rule. Rules added here live in a "Custom rules" policy, created on first use. */
  app.post('/rules', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = ruleInput.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid rule', code: 'INVALID_RULES' });
    const policies = await engine.list(request.tenantId);
    const custom = policies.find((p) => p.name === CUSTOM_POLICY_NAME && !p.sourceFramework);
    const rule = newRule(parsed.data, custom?.rules ?? []);
    if (custom) {
      await engine.update(request.tenantId, { ...custom, enabled: true, rules: [...custom.rules, rule] });
    } else {
      await engine.create(request.tenantId, {
        name: CUSTOM_POLICY_NAME, description: 'Rules added from the dashboard', enabled: true, rules: [rule], createdBy: request.userId,
      });
    }
    logger.info('Rule added', { tenantId: request.tenantId, ruleId: rule.ruleId, type: rule.type, by: request.userId });
    return reply.status(201).send(rule);
  });

  app.patch('/rules/:policyId/:ruleId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { policyId, ruleId } = request.params as { policyId: string; ruleId: string };
    const parsed = ruleChange.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid change', code: 'INVALID_RULES' });
    // Looked up within the caller's own tenant, so another tenant's policy can't be targeted.
    const policy = (await engine.list(request.tenantId)).find((p) => p.policyId === policyId);
    const updated = policy && applyRuleChange(policy, ruleId, parsed.data);
    if (!updated) return reply.status(404).send({ error: 'Rule not found', code: 'NOT_FOUND' });
    await engine.update(request.tenantId, updated);
    logger.info('Rule changed', { tenantId: request.tenantId, ruleId, change: Object.keys(parsed.data), by: request.userId });
    return { ok: true };
  });

  app.delete('/rules/:policyId/:ruleId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { policyId, ruleId } = request.params as { policyId: string; ruleId: string };
    const policy = (await engine.list(request.tenantId)).find((p) => p.policyId === policyId);
    if (!policy || !policy.rules.some((r) => r.ruleId === ruleId)) return reply.status(404).send({ error: 'Rule not found', code: 'NOT_FOUND' });
    if (policy.sourceFramework) {
      return reply.status(409).send({ error: `This rule is part of ${policy.sourceFramework}; turn it off instead`, code: 'FRAMEWORK_RULE' });
    }
    await engine.update(request.tenantId, { ...policy, rules: policy.rules.filter((r) => r.ruleId !== ruleId) });
    logger.info('Rule deleted', { tenantId: request.tenantId, ruleId, by: request.userId });
    return { ok: true };
  });

  /** Gateway settings a tenant admin controls. */
  app.get('/gateway/settings', { preHandler: requireAccess(TENANT_READ) }, async (request) => ({
    governanceFailMode: await tenantSettings().getFailMode(request.tenantId),
    secretsAction: await tenantSettings().getSecretsAction(request.tenantId),
    defaultFailMode: getSecurityConfig().governanceFailMode,
  }));

  app.put('/gateway/settings', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = z.object({
      governanceFailMode: z.enum(['open', 'closed']).optional(),
      secretsAction: z.enum(['block', 'redact', 'off']).optional(),
    }).strict().refine((b) => b.governanceFailMode !== undefined || b.secretsAction !== undefined).safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Send governanceFailMode (open or closed) and/or secretsAction (block, redact or off)', code: 'INVALID_SETTINGS' });
    }
    const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (parsed.data.governanceFailMode) set['settings.governanceFailMode'] = parsed.data.governanceFailMode;
    if (parsed.data.secretsAction) set['settings.secretsAction'] = parsed.data.secretsAction;
    const updated = await collection('tenants').update({ tenantId: request.tenantId }, { set, ifExists: true });
    if (!updated) return reply.status(404).send({ error: 'Tenant not found', code: 'NOT_FOUND' });
    tenantSettings().invalidate(request.tenantId);
    logger.info('Gateway settings changed', { tenantId: request.tenantId, ...parsed.data, by: request.userId });
    return parsed.data;
  });
}
