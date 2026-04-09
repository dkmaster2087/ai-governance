import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { evaluateRoutes } from './routes/evaluate.routes';
import { policyRoutes } from './routes/policy.routes';
import { complianceRoutes } from './routes/compliance.routes';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('policy-engine');
const PORT = parseInt(process.env.PORT || '3001', 10);

async function main() {
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(cors);
  await app.register(helmet);
  await app.register(evaluateRoutes, { prefix: '/v1' });
  await app.register(policyRoutes, { prefix: '/v1/policies' });
  await app.register(complianceRoutes, { prefix: '/v1/compliance' });

  app.get('/health', async () => ({ status: 'healthy', service: 'policy-engine' }));

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info('Policy engine started', { port: PORT });
  } catch (err) {
    logger.error('Failed to start policy engine', { error: err });
    process.exit(1);
  }
}

main();
