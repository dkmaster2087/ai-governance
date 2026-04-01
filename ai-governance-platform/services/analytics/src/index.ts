import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { metricsRoutes } from './routes/metrics.routes';
import { logsRoutes } from './routes/logs.routes';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('analytics');
const PORT = parseInt(process.env.PORT || '3003', 10);

async function main() {
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(helmet);
  await app.register(cors);
  await app.register(metricsRoutes, { prefix: '/v1/metrics' });
  await app.register(logsRoutes, { prefix: '/v1/logs' });
  app.get('/health', async () => ({ status: 'healthy', service: 'analytics' }));

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info('Analytics service started', { port: PORT });
  } catch (err) {
    logger.error('Failed to start analytics', { error: err });
    process.exit(1);
  }
}

main();
