import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import { createLogger, INTERNAL_HEADER, InternalAuthError, trustedKeysFromEnv, verifyInternal } from '@ai-governance/utils';
import { ReportingAgent } from './agent';
import { configRoutes } from './routes/config.routes';
import { statusRoutes } from './routes/status.routes';

const logger = createLogger('reporting-agent');
const PORT = parseInt(process.env.REPORTING_AGENT_PORT || '3005', 10);

async function main() {
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(helmet);

  // Its settings come from the environment. The API below is for operators inside the network, and only with
  // a signed internal token from an admin; there is no browser access.
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;
    const token = request.headers[INTERNAL_HEADER];
    try {
      if (typeof token !== 'string') throw new InternalAuthError('Missing token');
      const caller = verifyInternal(token, trustedKeysFromEnv(), 'reporting-agent');
      if (caller.role !== 'tenant_admin' && caller.role !== 'platform_admin') throw new InternalAuthError('Not an admin');
    } catch (err) {
      return reply.status(401).send({ error: (err as Error).message, code: 'UNAUTHORIZED' });
    }
  });

  await app.register(configRoutes, { prefix: '/v1/config' });
  await app.register(statusRoutes, { prefix: '/v1/status' });

  app.get('/health', async () => ({
    status: 'healthy',
    service: 'reporting-agent',
    timestamp: new Date().toISOString(),
  }));

  // Start the reporting agent background loop
  const agent = ReportingAgent.getInstance();
  agent.start();

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info('Reporting agent started', { port: PORT });
  } catch (err) {
    logger.error('Failed to start reporting agent', { error: err });
    process.exit(1);
  }
}

main();
