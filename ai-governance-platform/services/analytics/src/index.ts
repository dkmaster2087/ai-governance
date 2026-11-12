import { createLogger, internalTlsFromEnv, trustedKeysFromEnv } from '@ai-governance/utils';
import { buildApp } from './app';
import { syncCatalog } from './catalog-sync';

const logger = createLogger('analytics');
// In the single image's "all" role, reports run beside the gateway on a private address (see scripts/build-service.mjs).
const PORT = parseInt(process.env.ANALYTICS_PORT || process.env.PORT || '3003', 10);
const HOST = process.env.ANALYTICS_HOST || '0.0.0.0';
const loopback = HOST === '127.0.0.1' || HOST === '::1' || HOST === 'localhost';

async function main() {
  // Without the gateway's public key nothing could be answered safely: refuse to start.
  const tls = internalTlsFromEnv();
  // Across a network, mutual TLS is required in production. Inside one container, on loopback, nothing crosses one.
  if (!tls && !loopback && process.env.NODE_ENV === 'production') throw new Error('Mutual TLS is required in production: set INTERNAL_TLS_CA, INTERNAL_TLS_CERT and INTERNAL_TLS_KEY');
  const app = await buildApp({ trusted: trustedKeysFromEnv(), tls: loopback ? null : tls });
  await app.listen({ port: PORT, host: HOST });
  logger.info('Analytics service started', { port: PORT, host: HOST });
  // Tool names follow the catalog the gateway keeps current.
  syncCatalog();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { app.close().then(() => process.exit(0)); });
}

main().catch((err) => {
  logger.error('Failed to start analytics', { error: (err as Error).message });
  process.exit(1);
});
