import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { getSecurityConfig } from '../config/security';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:input-validation');

/**
 * Input validation middleware.
 * Enforces max body size and prompt length limits.
 */
async function inputValidationPlugin(app: FastifyInstance) {
  const config = getSecurityConfig();

  app.addHook('preHandler', async (request, reply) => {
    // Skip non-AI routes
    if (!request.url.includes('/chat/completions') && !request.url.includes('/proxy/')) return;

    const body = request.body as any;
    if (!body) return;

    // Validate prompt length
    if (body.messages && Array.isArray(body.messages)) {
      const totalLength = body.messages.reduce((sum: number, m: any) => sum + (m.content?.length || 0), 0);
      if (totalLength > config.maxPromptLength) {
        logger.warn('Prompt exceeds max length', { length: totalLength, max: config.maxPromptLength, tenantId: request.tenantId });
        return reply.status(413).send({
          error: 'Prompt too long',
          code: 'PROMPT_TOO_LONG',
          maxLength: config.maxPromptLength,
          actualLength: totalLength,
        });
      }
    }

    // Validate message count
    if (body.messages && body.messages.length > 100) {
      return reply.status(400).send({
        error: 'Too many messages',
        code: 'TOO_MANY_MESSAGES',
        max: 100,
      });
    }

    // Validate temperature range
    if (body.temperature !== undefined && (body.temperature < 0 || body.temperature > 2)) {
      return reply.status(400).send({
        error: 'Temperature must be between 0 and 2',
        code: 'INVALID_TEMPERATURE',
      });
    }

    // Validate max_tokens
    if (body.max_tokens !== undefined && (body.max_tokens < 1 || body.max_tokens > 200000)) {
      return reply.status(400).send({
        error: 'max_tokens must be between 1 and 200000',
        code: 'INVALID_MAX_TOKENS',
      });
    }
  });
}

export const inputValidation = fp(inputValidationPlugin);
