import { buildApp } from './app';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway');
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  const app = await buildApp();
  try {
    await app.listen({ port: PORT, host: HOST });
    logger.info('Gateway service started', { port: PORT });
  } catch (err) {
    logger.error('Failed to start gateway', { error: err });
    process.exit(1);
  }
}

main();
