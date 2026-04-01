import { FastifyInstance } from 'fastify';
import { ComplianceFramework } from '@ai-governance/types';
import { ComplianceService } from '../compliance/compliance.service';

export async function complianceRoutes(app: FastifyInstance) {
  const service = new ComplianceService();

  // List all available compliance packs
  app.get('/packs', async () => {
    return service.getAllPacks();
  });

  // Get a specific pack definition
  app.get('/packs/:framework', async (request) => {
    const { framework } = request.params as { framework: ComplianceFramework };
    return service.getPack(framework);
  });

  // Get tenant's enabled frameworks and their status
  app.get('/status/:tenantId', async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    const states = await service.getTenantComplianceStates(tenantId);
    const allPacks = service.getAllPacks();

    // Merge pack definitions with tenant state
    return allPacks.map((pack) => {
      const state = states.find((s) => s.framework === pack.framework);
      return {
        ...pack,
        status: state?.status ?? 'disabled',
        enabledAt: state?.enabledAt,
        passedControls: state?.passedControls ?? 0,
        totalControls: pack.controls.length,
        lastAssessedAt: state?.lastAssessedAt,
      };
    });
  });

  // Enable a framework for a tenant
  app.post('/enable/:tenantId/:framework', async (request, reply) => {
    const { tenantId, framework } = request.params as {
      tenantId: string;
      framework: ComplianceFramework;
    };
    const { enabledBy = 'admin' } = (request.body as { enabledBy?: string }) ?? {};
    const result = await service.enableFramework(tenantId, framework, enabledBy);
    return reply.status(201).send(result);
  });

  // Disable a framework
  app.delete('/disable/:tenantId/:framework', async (request, reply) => {
    const { tenantId, framework } = request.params as {
      tenantId: string;
      framework: ComplianceFramework;
    };
    const result = await service.disableFramework(tenantId, framework);
    return reply.status(200).send(result);
  });

  // Re-assess compliance status
  app.post('/assess/:tenantId/:framework', async (request) => {
    const { tenantId, framework } = request.params as {
      tenantId: string;
      framework: ComplianceFramework;
    };
    return service.assessCompliance(tenantId, framework);
  });
}
