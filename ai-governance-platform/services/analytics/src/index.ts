import { createLogger, internalKeyFromEnv } from '@ai-governance/utils';
import { buildApp } from './app';

const logger = createLogger('analytics');
const PORT = parseInt(process.env.PORT || '3003', 10);

async function main() {
  // Without the shared key nothing could be answered safely: refuse to start.
  const key = internalKeyFromEnv();
  const app = await buildApp({ key });
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info('Analytics service started', { port: PORT });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { app.close().then(() => process.exit(0)); });
}

main().catch((err) => {
  logger.error('Failed to start analytics', { error: (err as Error).message });
  process.exit(1);
});
