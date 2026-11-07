import { buildApp } from './app';
import { createLogger } from '@ai-governance/utils';
import { scheduleRetention } from './services/retention';
import { opsMetrics } from './services/cloudwatch';
import { exporter } from './log-export/exporter';

const logger = createLogger('gateway');
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  const app = await buildApp();
  try {
    await app.listen({ port: PORT, host: HOST });
    logger.info('Gateway service started', { port: PORT });
    scheduleRetention();
    opsMetrics.start();
    // Sends companies' records to their log destinations. Off only for a gateway that mustn't send (LOG_EXPORT_WORKER=off).
    if (process.env.LOG_EXPORT_WORKER !== 'off') exporter().start();
  } catch (err) {
    logger.error('Failed to start gateway', { error: err });
    process.exit(1);
  }
}

main();
