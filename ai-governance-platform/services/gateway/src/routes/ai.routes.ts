import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GatewayService } from '../services/gateway.service';

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
  app.post('/chat/completions', async (request, reply) => {
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

    return reply.send(result);
  });

  // List available models for this tenant
  app.get('/models', async (request) => {
    return gatewayService.getAvailableModels(request.tenantId);
  });
}
