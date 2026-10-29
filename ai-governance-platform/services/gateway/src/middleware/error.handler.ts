import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway');

export function errorHandler(error: FastifyError | AppError | ZodError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    logger.warn('Application error', { code: error.code, message: error.message, requestId: request.id });
    return reply.status(error.statusCode).send({ error: error.code, code: error.code, message: error.message, requestId: request.id });
  }

  // Invalid request bodies are the caller's mistake, not a server failure.
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: 'INVALID_REQUEST',
      code: 'INVALID_REQUEST',
      message: 'The request is missing fields or has invalid values',
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      requestId: request.id,
    });
  }

  // Errors carrying a 4xx status (malformed JSON, body too large, rate limits, plain objects thrown with
  // a code and statusCode) keep their status and message.
  const status = (error as { statusCode?: number }).statusCode;
  if (status && status >= 400 && status < 500) {
    const code = (error as { code?: string }).code ?? 'BAD_REQUEST';
    return reply.status(status).send({ error: code, code, message: error.message, requestId: request.id });
  }

  logger.error('Unhandled error', { error: error.message, requestId: request.id });
  return reply.status(500).send({ error: 'INTERNAL_ERROR', code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: request.id });
}
