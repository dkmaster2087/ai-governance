import { createLogger, internalTlsFromEnv, trustedKeysFromEnv } from '@ai-governance/utils';
import { buildApp } from './app';

const logger = createLogger('data-protection');
const PORT = parseInt(process.env.PORT || '3002', 10);

async function main() {
  trustedKeysFromEnv(); // refuse to start without the gateway's public key, rather than refuse every request
  const tls = internalTlsFromEnv();
  if (!tls && process.env.NODE_ENV === 'production') throw new Error('Mutual TLS is required in production: set INTERNAL_TLS_CA, INTERNAL_TLS_CERT and INTERNAL_TLS_KEY');
  const app = await buildApp({ tls });
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info('Data protection service started', { port: PORT });
}

main().catch((err) => {
  logger.error('Failed to start data-protection', { error: (err as Error).message });
  process.exit(1);
});
