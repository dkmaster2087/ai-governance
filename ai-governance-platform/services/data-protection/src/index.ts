import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import { protectionRoutes } from './routes/protection.routes';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('data-protection');
const PORT = parseInt(process.env.PORT || '3002', 10);

async function main() {
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(helmet);
  await app.register(protectionRoutes, { prefix: '/v1/protect' });
  app.get('/health', async () => ({ status: 'healthy', service: 'data-protection' }));

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info('Data protection service started', { port: PORT });
  } catch (err) {
    logger.error('Failed to start data-protection', { error: err });
    process.exit(1);
  }
}

main();
