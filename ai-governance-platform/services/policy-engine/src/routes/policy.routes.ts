import { FastifyInstance } from 'fastify';
import { PolicyRepository } from '../repositories/policy.repository';
import { ComplianceService } from '../compliance/compliance.service';
import { ComplianceFramework } from '@ai-governance/types';

export async function policyRoutes(app: FastifyInstance) {
  const repo = new PolicyRepository();
  const complianceService = new ComplianceService();

  // List policies for a tenant
  app.get('/:tenantId', async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    return repo.getPoliciesForTenant(tenantId);
  });

  // Create policy
  app.post('/', async (request, reply) => {
    const policy = await repo.createPolicy(request.body as any);
    return reply.status(201).send(policy);
  });

  // Update policy — requires tenantId in body
  app.put('/:tenantId/:policyId', async (request) => {
    const { tenantId, policyId } = request.params as { tenantId: string; policyId: string };
    const body = request.body as any;

    // Look up existing policy to check framework link before updating
    const existing = (await repo.getPoliciesForTenant(tenantId)).find((p) => p.policyId === policyId);

    const result = await repo.updatePolicy(policyId, body);

    // If a framework-linked policy is being disabled, disable the framework too
    if (existing?.sourceFramework && body.enabled === false) {
      await complianceService.disableFramework(tenantId, existing.sourceFramework as ComplianceFramework).catch(() => {});
    }

    // If a framework-linked policy is being re-enabled, re-enable the framework too
    if (existing?.sourceFramework && body.enabled === true) {
      await complianceService.enableFramework(tenantId, existing.sourceFramework as ComplianceFramework, 'admin').catch(() => {});
    }

    return { ...result, sourceFramework: existing?.sourceFramework };
  });

  // Delete policy — tenantId + policyId composite key
  app.delete('/:tenantId/:policyId', async (request, reply) => {
    const { tenantId, policyId } = request.params as { tenantId: string; policyId: string };

    // Check if this policy is linked to a framework before deleting
    const policies = await repo.getPoliciesForTenant(tenantId);
    const policy = policies.find((p) => p.policyId === policyId);

    await repo.deletePolicy(policyId, tenantId);

    // If it was framework-linked, disable the framework
    if (policy?.sourceFramework) {
      await complianceService.disableFramework(tenantId, policy.sourceFramework as ComplianceFramework).catch(() => {});
    }

    return reply.status(200).send({
      deleted: true,
      disabledFramework: policy?.sourceFramework ?? null,
    });
  });
}
