import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAccess, requireTenantParam, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { PolicyAdminClient } from '../clients/policy-admin.client';
import { PolicyRule } from '@ai-governance/types';

/**
 * Whole-policy and compliance-pack management for the dashboard, forwarded to the internal policy engine.
 * The tenant always comes from the caller (or, for platform admins, a URL tenant they're allowed to act on).
 */
const ruleSchema = z.object({
  ruleId: z.string().min(1).max(100),
  // Compliance packs use rule types beyond the ones the gateway enforces, so accept any short name.
  type: z.string().min(1).max(50).transform((t) => t as PolicyRule['type']),
  action: z.enum(['allow', 'block', 'mask', 'warn', 'redact']),
  priority: z.number().int().min(0).max(10_000),
  enabled: z.boolean(),
  description: z.string().max(300),
  config: z.record(z.unknown()),
});
const policySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).default(''),
  enabled: z.boolean().default(true),
  rules: z.array(ruleSchema).max(200),
  sourceFramework: z.string().max(50).optional(),
});
const FRAMEWORK = /^[a-z0-9-]{1,40}$/;

export async function policiesRoutes(app: FastifyInstance) {
  const engine = new PolicyAdminClient();

  app.get('/policies', { preHandler: requireAccess(TENANT_READ) }, async (request) => engine.list(request.tenantId));
  app.get('/policies/:tenantId', { preHandler: [requireAccess(TENANT_READ), requireTenantParam] }, async (request) =>
    engine.list((request.params as { tenantId: string }).tenantId));

  app.post('/policies', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = policySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid policy', code: 'INVALID_POLICY' });
    const created = await engine.create(request.tenantId, { ...parsed.data, createdBy: request.userId });
    return reply.status(201).send(created);
  });

  app.put('/policies/:policyId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { policyId } = request.params as { policyId: string };
    const parsed = policySchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid policy', code: 'INVALID_POLICY' });
    const existing = (await engine.list(request.tenantId)).find((p) => p.policyId === policyId);
    if (!existing) return reply.status(404).send({ error: 'Policy not found', code: 'NOT_FOUND' });
    const updated = { ...existing, ...parsed.data, sourceFramework: existing.sourceFramework };
    await engine.update(request.tenantId, updated);
    return updated;
  });

  app.delete('/policies/:policyId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { policyId } = request.params as { policyId: string };
    if (!(await engine.list(request.tenantId)).some((p) => p.policyId === policyId)) {
      return reply.status(404).send({ error: 'Policy not found', code: 'NOT_FOUND' });
    }
    return engine.remove(request.tenantId, policyId);
  });

  // ── Compliance packs ──────────────────────────────────────────────────
  app.get('/compliance/packs', { preHandler: requireAccess(TENANT_READ) }, async () => engine.compliance('get', '/packs'));

  app.get('/compliance/packs/:framework', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const { framework } = request.params as { framework: string };
    if (!FRAMEWORK.test(framework)) return reply.status(404).send({ error: 'Unknown framework', code: 'NOT_FOUND' });
    return engine.compliance('get', `/packs/${framework}`);
  });

  app.get('/compliance/status/:tenantId', { preHandler: [requireAccess(TENANT_READ), requireTenantParam] }, async (request) =>
    engine.compliance('get', `/status/${encodeURIComponent((request.params as { tenantId: string }).tenantId)}`));

  const change = (method: 'post' | 'delete', action: 'enable' | 'disable' | 'assess') =>
    async (request: { params: unknown; userId: string }, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
      const { tenantId, framework } = request.params as { tenantId: string; framework: string };
      if (!FRAMEWORK.test(framework)) return reply.status(404).send({ error: 'Unknown framework', code: 'NOT_FOUND' });
      return engine.compliance(method, `/${action}/${encodeURIComponent(tenantId)}/${framework}`, action === 'enable' ? { enabledBy: request.userId } : undefined);
    };
  app.post('/compliance/enable/:tenantId/:framework', { preHandler: [requireAccess(TENANT_ADMIN), requireTenantParam] }, change('post', 'enable') as never);
  app.delete('/compliance/disable/:tenantId/:framework', { preHandler: [requireAccess(TENANT_ADMIN), requireTenantParam] }, change('delete', 'disable') as never);
  app.post('/compliance/assess/:tenantId/:framework', { preHandler: [requireAccess(TENANT_READ), requireTenantParam] }, change('post', 'assess') as never);
}
