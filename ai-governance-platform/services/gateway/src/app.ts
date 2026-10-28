import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { aiRoutes } from './routes/ai.routes';
import { healthRoutes } from './routes/health.routes';
import { contactRoutes } from './routes/contact.routes';
import { modelConfigRoutes } from './routes/model-config.routes';
import { tenantRoutes } from './routes/tenant.routes';
import { shadowAIRoutes } from './routes/shadow-ai.routes';
import { costRoutes } from './routes/cost.routes';
import { proxyRoutes } from './routes/proxy.routes';
import { apiKeyRoutes } from './routes/api-key.routes';
import { alertRoutes } from './routes/alert.routes';
import { reportingRoutes } from './routes/reporting.routes';
import { errorHandler } from './middleware/error.handler';
import { authMiddleware } from './middleware/auth.middleware';
import { inputValidation } from './middleware/input-validation';
import { setupGracefulShutdown } from './middleware/graceful-shutdown';
import { requestTracing } from './middleware/request-tracing';
import { getSecurityConfig } from './config/security';
import { metricsRoutes } from './routes/metrics.routes';

export async function buildApp() {
  const securityConfig = getSecurityConfig();

  const app = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: securityConfig.maxBodySize,
  });

  // Security plugins
  await app.register(helmet, {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(cors, {
    origin: securityConfig.allowedOrigins.length > 0 ? securityConfig.allowedOrigins : true,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: securityConfig.globalRateLimit,
    timeWindow: '1 minute',
  });

  // Auth & validation
  await app.register(requestTracing);
  await app.register(authMiddleware);
  await app.register(inputValidation);

  // Routes
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(contactRoutes, { prefix: '/public' });
  await app.register(aiRoutes, { prefix: '/v1' });
  await app.register(modelConfigRoutes, { prefix: '/v1' });
  await app.register(tenantRoutes, { prefix: '/v1' });
  await app.register(shadowAIRoutes, { prefix: '/v1' });
  await app.register(costRoutes, { prefix: '/v1' });
  await app.register(proxyRoutes, { prefix: '/v1' });
  await app.register(apiKeyRoutes, { prefix: '/v1' });
  await app.register(alertRoutes, { prefix: '/v1' });
  await app.register(reportingRoutes, { prefix: '/v1' });
  await app.register(metricsRoutes, { prefix: '/internal' });

  // Error handler
  app.setErrorHandler(errorHandler);

  // Graceful shutdown
  setupGracefulShutdown(app);

  return app;
}
