import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import { createLogger, guardInternal, InternalTls, tlsServerOptions, TrustedKey } from '@ai-governance/utils';
import { evaluateRoutes } from './routes/evaluate.routes';
import { policyRoutes } from './routes/policy.routes';
import { complianceRoutes } from './routes/compliance.routes';

const logger = createLogger('policy-engine');

/** The reporting agent of an on-prem install may read framework status, nothing else. */
const agentMay = (method: string, path: string) => method === 'GET' && /^\/v1\/compliance\/status\/[^/]+$/.test(path);

export async function buildApp(opts: { trusted?: () => TrustedKey[]; tls?: InternalTls | null } = {}) {
  // With mutual TLS, every connection is encrypted and callers must show a Probaline service certificate.
  const app = Fastify({ logger: false, ...(opts.tls ? { https: tlsServerOptions(opts.tls) } : {}) }) as unknown as FastifyInstance;
  await app.register(helmet);
  app.get('/health', async () => ({ status: 'healthy', service: 'policy-engine' }));
  // Only the gateway (and an install's reporting agent) may call, and only about the company it signs for.
  guardInternal(app, {
    audience: 'policy-engine',
    trusted: opts.trusted,
    ...(opts.tls ? { peers: ['gateway', 'reporting-agent'] } : {}),
    allow: (role, method, path) => role === 'gateway' || (role === 'reporting_agent' && agentMay(method, path)),
    onRefused: (reason, path) => logger.warn('Refused an internal request', { reason, path }),
  });
  await app.register(evaluateRoutes, { prefix: '/v1' });
  await app.register(policyRoutes, { prefix: '/v1/policies' });
  await app.register(complianceRoutes, { prefix: '/v1/compliance' });
  return app;
}
