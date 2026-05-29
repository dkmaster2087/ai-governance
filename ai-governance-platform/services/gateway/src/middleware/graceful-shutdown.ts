import { FastifyInstance } from 'fastify';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:shutdown');

/**
 * Graceful shutdown handler.
 * Drains connections and closes the server cleanly on SIGTERM/SIGINT.
 */
export function setupGracefulShutdown(app: FastifyInstance): void {
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Received shutdown signal, draining connections...', { signal });

    // Give in-flight requests 10 seconds to complete
    const timeout = setTimeout(() => {
      logger.warn('Shutdown timeout reached, forcing exit');
      process.exit(1);
    }, 10000);

    try {
      await app.close();
      clearTimeout(timeout);
      logger.info('Server closed gracefully');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: err });
      clearTimeout(timeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Health check returns 503 during shutdown
  app.addHook('onRequest', async (_request, reply) => {
    if (isShuttingDown) {
      return reply.status(503).send({ error: 'Service shutting down' });
    }
  });
}
