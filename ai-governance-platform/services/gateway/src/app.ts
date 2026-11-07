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
import { gatewayRoutes } from './routes/gateway.routes';
import { platformRoutes } from './routes/platform.routes';
import { rulesRoutes } from './routes/rules.routes';
import { evidenceRoutes } from './routes/evidence.routes';
import { policiesRoutes } from './routes/policies.routes';
import { mcpRoutes } from './routes/mcp.routes';
import { usersRoutes } from './routes/users.routes';
import { mcpOauthRoutes } from './routes/mcp-oauth.routes';
import { mcpApprovalRoutes } from './routes/mcp-approvals.routes';
import { mcpConnectorRoutes } from './routes/mcp-connectors.routes';

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
    // Deployed, the dashboard and website reach the gateway on their own address (CloudFront's /api), so no
    // other website needs access: an empty ALLOWED_ORIGINS means none. The browser extension calls from a
    // chrome-extension:// origin and authenticates with an API key. Requests without an origin aren't browsers.
    origin: (origin, cb) => cb(null, !origin || securityConfig.allowedOrigins.includes(origin) || origin.startsWith('chrome-extension://')),
    credentials: true,
  });
  await app.register(rateLimit, {
    max: securityConfig.globalRateLimit,
    timeWindow: '1 minute',
  });

  // Error handler: set before any routes so every plugin inherits it.
  app.setErrorHandler(errorHandler);

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
  await app.register(gatewayRoutes, { prefix: '/v1' });
  await app.register(platformRoutes, { prefix: '/v1' });
  await app.register(rulesRoutes, { prefix: '/v1' });
  await app.register(evidenceRoutes, { prefix: '/v1' });
  await app.register(policiesRoutes, { prefix: '/v1' });
  await app.register(usersRoutes, { prefix: '/v1' });
  // MCP servers: admin API under /v1/mcp/…, and the address agents connect to at /mcp/<tenant>/<server>.
  await app.register(mcpRoutes);
  await app.register(mcpOauthRoutes);
  await app.register(mcpApprovalRoutes);
  await app.register(mcpConnectorRoutes);
  await app.register(metricsRoutes, { prefix: '/internal' });

  // Graceful shutdown
  setupGracefulShutdown(app);

  return app;
}
