import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GatewayService } from '../services/gateway.service';
import { requireAccess } from '../auth/guards';
import { NormalizedAIResponse } from '@ai-governance/types';

/** The OpenAI chat.completion shape, so apps can use the OpenAI SDKs unchanged. `id` is the Aegis request ID. */
export function toOpenAIResponse(r: NormalizedAIResponse) {
  return {
    id: r.requestId,
    object: 'chat.completion',
    created: Math.floor(new Date(r.timestamp).getTime() / 1000),
    model: r.modelId,
    choices: [{ index: 0, message: { role: 'assistant', content: r.content }, finish_reason: r.finishReason || 'stop' }],
    usage: { prompt_tokens: r.inputTokens, completion_tokens: r.outputTokens, total_tokens: r.inputTokens + r.outputTokens },
  };
}

const chatRequestSchema = z.object({
  model: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string(),
    })
  ),
  max_tokens: z.number().optional(),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional().default(false),
});

export async function aiRoutes(app: FastifyInstance) {
  const gatewayService = new GatewayService();

  // OpenAI-compatible chat completions endpoint
  app.post('/chat/completions', { preHandler: requireAccess({ roles: ['tenant_admin', 'tenant_auditor', 'tenant_user'], scopes: ['chat'] }) }, async (request, reply) => {
    const body = chatRequestSchema.parse(request.body);

    const result = await gatewayService.processRequest({
      tenantId: request.tenantId,
      userId: request.userId,
      appId: request.appId,
      model: body.model,
      messages: body.messages,
      maxTokens: body.max_tokens,
      temperature: body.temperature,
    });

    return reply.send(toOpenAIResponse(result));
  });

  // List available models for this tenant
  app.get('/models', { preHandler: requireAccess({ roles: ['tenant_admin', 'tenant_auditor', 'tenant_user'], scopes: ['chat', 'models'] }) }, async (request) => {
    return gatewayService.getAvailableModels(request.tenantId);
  });
}
