import { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/', async () => ({
    status: 'healthy',
    service: 'gateway',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '1.0.0',
  }));

  app.get('/ready', async () => ({
    status: 'ready',
    timestamp: new Date().toISOString(),
  }));
}
