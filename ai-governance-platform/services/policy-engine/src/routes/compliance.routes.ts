import { FastifyInstance } from 'fastify';
import { ComplianceFramework } from '@ai-governance/types';
import { ComplianceService, ALL_PACKS } from '../compliance/compliance.service';

export async function complianceRoutes(app: FastifyInstance) {
  const service = new ComplianceService();

  // Unknown frameworks (including ones removed from the product) get a 404 instead of a crash.
  // Disabling is still allowed so old state can be cleaned up.
  app.addHook('preHandler', async (request, reply) => {
    const { framework } = (request.params ?? {}) as { framework?: string };
    if (framework && !(framework in ALL_PACKS) && !request.url.includes('/disable/')) {
      return reply.status(404).send({ error: 'Unknown compliance framework', code: 'UNKNOWN_FRAMEWORK', framework });
    }
  });

  // List all available compliance packs
  app.get('/packs', async () => {
    return service.getAllPacks();
  });

  // Get a specific pack definition
  app.get('/packs/:framework', async (request) => {
    const { framework } = request.params as { framework: ComplianceFramework };
    return service.getPack(framework);
  });

  // Each framework, whether it's on, and (when on) every control as it stands right now.
  app.get('/status/:tenantId', async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    const states = await service.getTenantComplianceStates(tenantId);
    return Promise.all(service.getAllPacks().map(async (pack) => {
      const state = states.find((s) => s.framework === pack.framework);
      if (!state) return { ...pack, status: 'disabled', passedControls: 0, totalControls: pack.controls.length };
      const a = await service.assess(tenantId, pack.framework);
      const byId = new Map(a.controls.map((c) => [c.controlId, c]));
      // Each control with its definition and how it stands now.
      return {
        ...pack, ...a, enabledAt: state.enabledAt, lastAssessedAt: new Date().toISOString(),
        controls: pack.controls.map((c) => ({ ...c, ...byId.get(c.controlId) })),
      };
    }));
  });

  // Bring a framework's rules up to date (keeps what the company filled in, such as allowed models)
  app.post('/sync/:tenantId/:framework', async (request) => {
    const { tenantId, framework } = request.params as { tenantId: string; framework: ComplianceFramework };
    return service.syncFramework(tenantId, framework);
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
