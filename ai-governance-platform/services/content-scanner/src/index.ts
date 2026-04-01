import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { scanRoutes } from './routes/scan.routes';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('content-scanner');
const PORT = parseInt(process.env.PORT || '3004', 10);

async function main() {
  const app = Fastify({ logger: false, trustProxy: true });

  await app.register(helmet);
  await app.register(cors);
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB max per file
      files: 10,                   // Max 10 files per request
    },
  });

  await app.register(scanRoutes, { prefix: '/v1/scan' });

  app.get('/health', async () => ({
    status: 'healthy',
    service: 'content-scanner',
    timestamp: new Date().toISOString(),
  }));

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info('Content scanner service started', { port: PORT });
  } catch (err) {
    logger.error('Failed to start content-scanner', { error: err });
    process.exit(1);
  }
}

main();
