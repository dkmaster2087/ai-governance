import { createLogger, internalTlsFromEnv, trustedKeysFromEnv } from '@ai-governance/utils';
import { buildApp } from './app';

const logger = createLogger('analytics');
const PORT = parseInt(process.env.PORT || '3003', 10);

async function main() {
  // Without the gateway's public key nothing could be answered safely: refuse to start.
  const tls = internalTlsFromEnv();
  if (!tls && process.env.NODE_ENV === 'production') throw new Error('Mutual TLS is required in production: set INTERNAL_TLS_CA, INTERNAL_TLS_CERT and INTERNAL_TLS_KEY');
  const app = await buildApp({ trusted: trustedKeysFromEnv(), tls });
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info('Analytics service started', { port: PORT });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { app.close().then(() => process.exit(0)); });
}

main().catch((err) => {
  logger.error('Failed to start analytics', { error: (err as Error).message });
  process.exit(1);
});
