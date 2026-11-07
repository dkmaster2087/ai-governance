import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import { createLogger, guardInternal, InternalTls, tlsServerOptions, TrustedKey } from '@ai-governance/utils';
import { protectionRoutes } from './routes/protection.routes';

const logger = createLogger('data-protection');

export async function buildApp(opts: { trusted?: () => TrustedKey[]; tls?: InternalTls | null } = {}) {
  // With mutual TLS, every connection is encrypted and callers must show a Probaline service certificate.
  const app = Fastify({ logger: false, ...(opts.tls ? { https: tlsServerOptions(opts.tls) } : {}) }) as unknown as FastifyInstance;
  await app.register(helmet);
  app.get('/health', async () => ({ status: 'healthy', service: 'data-protection' }));
  // Only the gateway may call, and only about the company it signs for.
  guardInternal(app, {
    audience: 'data-protection',
    trusted: opts.trusted,
    ...(opts.tls ? { peers: ['gateway'] } : {}),
    allow: (role) => role === 'gateway',
    onRefused: (reason, path) => logger.warn('Refused an internal request', { reason, path }),
  });
  await app.register(protectionRoutes, { prefix: '/v1/protect' });
  return app;
}
