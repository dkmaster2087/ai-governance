import { createLogger, internalKeyFromEnv } from '@ai-governance/utils';
import { buildApp } from './app';

const logger = createLogger('data-protection');
const PORT = parseInt(process.env.PORT || '3002', 10);

async function main() {
  internalKeyFromEnv(); // refuse to start without the key, rather than refuse every request
  const app = await buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info('Data protection service started', { port: PORT });
}

main().catch((err) => {
  logger.error('Failed to start data-protection', { error: (err as Error).message });
  process.exit(1);
});
