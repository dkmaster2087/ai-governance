import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { aiRoutes } from './routes/ai.routes';
import { healthRoutes } from './routes/health.routes';
import { contactRoutes } from './routes/contact.routes';
import { modelConfigRoutes } from './routes/model-config.routes';
import { multimodalRoutes } from './routes/multimodal.routes';
import { tenantRoutes } from './routes/tenant.routes';
import { shadowAIRoutes } from './routes/shadow-ai.routes';
import { costRoutes } from './routes/cost.routes';
import { errorHandler } from './middleware/error.handler';
import { authMiddleware } from './middleware/auth.middleware';

export async function buildApp() {
  const app = Fastify({
    logger: false, // We use our own structured logger
    trustProxy: true,
  });

  // Security plugins
  await app.register(helmet);
  await app.register(cors, {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || false,
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Auth
  await app.register(authMiddleware);

  // Routes
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(contactRoutes, { prefix: '/public' });
  await app.register(aiRoutes, { prefix: '/v1' });
  await app.register(modelConfigRoutes, { prefix: '/v1' });
  await app.register(multimodalRoutes, { prefix: '/v1' });
  await app.register(tenantRoutes, { prefix: '/v1' });
  await app.register(shadowAIRoutes, { prefix: '/v1' });
  await app.register(costRoutes, { prefix: '/v1' });

  // Error handler
  app.setErrorHandler(errorHandler);

  return app;
}
