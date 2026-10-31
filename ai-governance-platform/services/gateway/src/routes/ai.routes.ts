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
  stream_options: z.object({ include_usage: z.boolean().optional() }).optional(),
});

export async function aiRoutes(app: FastifyInstance) {
  const gatewayService = new GatewayService();

  // OpenAI-compatible chat completions endpoint
  app.post('/chat/completions', { preHandler: requireAccess({ roles: ['tenant_admin', 'tenant_auditor', 'tenant_user'], scopes: ['chat'] }) }, async (request, reply) => {
    const body = chatRequestSchema.parse(request.body);

    const input = {
      tenantId: request.tenantId,
      userId: request.userId,
      appId: request.appId,
      model: body.model,
      messages: body.messages,
      maxTokens: body.max_tokens,
      temperature: body.temperature,
    };

    if (!body.stream) return reply.send(toOpenAIResponse(await gatewayService.processRequest(input)));

    // Streaming: checks and the provider's first chunk happen before any byte is sent, so a blocked
    // request or a provider error still arrives as a normal JSON error.
    const abort = new AbortController();
    const { requestId, parts } = await gatewayService.processStream(input, abort.signal);
    reply.hijack();
    const res = reply.raw;
    let finished = false;
    res.on('close', () => {
      if (finished) return;
      abort.abort();
      parts.return(undefined).catch(() => undefined);
    });
    // Headers set by plugins (CORS, request ID) are on the reply; carry them over to the raw response.
    res.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-aegis-request-id': requestId,
    });
    const base = { id: requestId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model };
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
    try {
      for await (const part of parts) {
        if (part.done) {
          send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: part.finishReason }] });
          if (body.stream_options?.include_usage) {
            send({ ...base, choices: [], usage: { prompt_tokens: part.inputTokens, completion_tokens: part.outputTokens, total_tokens: part.inputTokens + part.outputTokens } });
          }
        } else {
          send({ ...base, choices: [{ index: 0, delta: { content: part.text }, finish_reason: null }] });
        }
      }
      res.write('data: [DONE]\n\n');
    } catch (err) {
      request.log.error({ err, requestId }, 'stream failed');
      send({ error: { message: 'The AI provider stopped responding', type: 'provider_error', code: 'PROVIDER_ERROR' } });
    } finally {
      finished = true;
      res.end();
    }
  });

  // List available models for this tenant
  app.get('/models', { preHandler: requireAccess({ roles: ['tenant_admin', 'tenant_auditor', 'tenant_user'], scopes: ['chat', 'models'] }) }, async (request) => {
    return gatewayService.getAvailableModels(request.tenantId);
  });
}
