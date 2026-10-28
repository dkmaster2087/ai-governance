import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ModelConfigService } from '../services/model-config.service';
import { requireAccess, TENANT_ADMIN, TENANT_READ } from '../auth/guards';

const modelSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(['bedrock', 'openai', 'anthropic', 'azure-openai', 'google-vertex', 'custom']),
  modelId: z.string().min(1),
  status: z.enum(['active', 'inactive', 'testing']).default('active'),
  isDefault: z.boolean().default(false),
  endpoint: z.string().url().optional().or(z.literal('')),
  region: z.string().optional(),
  apiKey: z.string().optional(),          // Stored in Secrets Manager, never persisted raw
  deploymentName: z.string().optional(),
  maxTokensPerRequest: z.number().int().positive().default(4096),
  inputCostPer1kTokens: z.number().min(0).default(0),
  outputCostPer1kTokens: z.number().min(0).default(0),
  maxContextTokens: z.number().int().positive().default(8192),
  allowedForRoles: z.array(z.string()).default([]),
  allowedForApps: z.array(z.string()).default([]),
  requiresApproval: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
});

export async function modelConfigRoutes(app: FastifyInstance) {
  const service = new ModelConfigService();

  // List all model configs for tenant
  app.get('/models/config', { preHandler: requireAccess(TENANT_READ) }, async (request) => {
    return service.getModelsForTenant(request.tenantId);
  });

  // Create a new model config
  app.post('/models/config', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const body = modelSchema.parse(request.body);
    const { apiKey, ...data } = body;
    // The raw key goes to Secrets Manager; the config only keeps its ARN and a display hint.
    const config = await service.createModel(
      request.tenantId,
      { ...data, createdBy: request.userId },
      request.userId,
      apiKey || undefined
    );
    return reply.status(201).send(config);
  });

  // Update a model config
  app.put('/models/config/:modelConfigId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request) => {
    const { modelConfigId } = request.params as { modelConfigId: string };
    const body = modelSchema.partial().parse(request.body);
    const { apiKey, ...data } = body;
    return service.updateModel(request.tenantId, modelConfigId, data, apiKey || undefined);
  });

  // Delete a model config
  app.delete('/models/config/:modelConfigId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { modelConfigId } = request.params as { modelConfigId: string };
    await service.deleteModel(request.tenantId, modelConfigId);
    return reply.status(204).send();
  });

  // Test connectivity for a model config
  app.post('/models/config/:modelConfigId/test', { preHandler: requireAccess(TENANT_ADMIN) }, async (request) => {
    const { modelConfigId } = request.params as { modelConfigId: string };
    return service.testModel(request.tenantId, modelConfigId);
  });
}
