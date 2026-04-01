import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@ai-governance/utils';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway');

export function errorHandler(
  error: FastifyError | AppError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (error instanceof AppError) {
    logger.warn('Application error', {
      code: error.code,
      message: error.message,
      requestId: request.id,
    });
    return reply.status(error.statusCode).send({
      error: error.code,
      message: error.message,
      requestId: request.id,
    });
  }

  logger.error('Unhandled error', { error: error.message, requestId: request.id });
  return reply.status(500).send({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    requestId: request.id,
  });
}
