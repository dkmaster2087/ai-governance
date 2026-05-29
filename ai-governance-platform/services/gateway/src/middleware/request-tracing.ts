import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'crypto';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
    requestStartTime: number;
  }
}

/**
 * Request tracing middleware.
 * Assigns a correlation ID to every request for distributed tracing.
 * Adds timing information for latency tracking.
 */
async function requestTracingPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    // Use incoming correlation ID or generate one
    request.correlationId = (request.headers['x-correlation-id'] as string)
      || (request.headers['x-request-id'] as string)
      || randomUUID();
    request.requestStartTime = Date.now();
  });

  app.addHook('onSend', async (request, reply) => {
    // Add tracing headers to response
    reply.header('x-correlation-id', request.correlationId);
    reply.header('x-request-duration-ms', String(Date.now() - request.requestStartTime));
  });
}

export const requestTracing = fp(requestTracingPlugin);
