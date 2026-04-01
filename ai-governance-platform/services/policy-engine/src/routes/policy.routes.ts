import { FastifyInstance } from 'fastify';
import { PolicyRepository } from '../repositories/policy.repository';

export async function policyRoutes(app: FastifyInstance) {
  const repo = new PolicyRepository();

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
    const { policyId } = request.params as { tenantId: string; policyId: string };
    const body = request.body as any;
    return repo.updatePolicy(policyId, body);
  });

  // Delete policy — tenantId + policyId composite key
  app.delete('/:tenantId/:policyId', async (request, reply) => {
    const { tenantId, policyId } = request.params as { tenantId: string; policyId: string };
    await repo.deletePolicy(policyId, tenantId);
    return reply.status(204).send();
  });
}
