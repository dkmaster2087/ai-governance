import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

// Extend FastifyRequest to carry tenant/user context
declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    userId: string;
    appId: string;
  }
}

async function authPlugin(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    // Skip health checks and public routes
    if (request.url.startsWith('/health') || request.url.startsWith('/public')) return;

    const tenantId = request.headers['x-tenant-id'] as string;
    const userId = request.headers['x-user-id'] as string;
    const appId = request.headers['x-app-id'] as string;
    const apiKey = request.headers['authorization'];

    if (!tenantId || !apiKey) {
      return reply.status(401).send({ error: 'Unauthorized', code: 'MISSING_AUTH' });
    }

    // TODO: validate API key against DynamoDB tenant table
    request.tenantId = tenantId;
    request.userId = userId || 'anonymous';
    request.appId = appId || 'unknown';
  });
}

export const authMiddleware = fp(authPlugin);
