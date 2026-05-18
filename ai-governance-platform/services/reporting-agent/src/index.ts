import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { createLogger } from '@ai-governance/utils';
import { ReportingAgent } from './agent';
import { configRoutes } from './routes/config.routes';
import { statusRoutes } from './routes/status.routes';

const logger = createLogger('reporting-agent');
const PORT = parseInt(process.env.REPORTING_AGENT_PORT || '3005', 10);

async function main() {
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(cors);
  await app.register(helmet);

  // Routes for configuring the agent
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
