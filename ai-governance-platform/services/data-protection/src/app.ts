import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import { createLogger, guardInternal } from '@ai-governance/utils';
import { protectionRoutes } from './routes/protection.routes';

const logger = createLogger('data-protection');

export async function buildApp(opts: { key?: () => string } = {}) {
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(helmet);
  app.get('/health', async () => ({ status: 'healthy', service: 'data-protection' }));
  // Only the gateway may call, and only about the company it signs for.
  guardInternal(app, {
    audience: 'data-protection',
    key: opts.key,
    allow: (role) => role === 'gateway',
    onRefused: (reason, path) => logger.warn('Refused an internal request', { reason, path }),
  });
  await app.register(protectionRoutes, { prefix: '/v1/protect' });
  return app;
}
