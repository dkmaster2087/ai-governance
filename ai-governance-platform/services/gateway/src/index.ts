import { buildApp } from './app';
import { createLogger } from '@ai-governance/utils';
import { scheduleRetention } from './services/retention';
import { scheduleKeyRotation } from './mcp/keys';
import { opsMetrics } from './services/cloudwatch';
import { exporter } from './log-export/exporter';
import { secretBackend, usesDatabaseSecrets } from './services/secret-store';
import { bootstrapInstall, installSignIn } from './install/sign-in';
import { scheduleLicenseNotices } from './services/license-notices';
import { mailer } from './services/email';
import { catalogUpdater } from './catalog/catalog-updater';

const logger = createLogger('gateway');
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  // A database secret store needs its key before anything is saved or read.
  if (usesDatabaseSecrets()) {
    try { secretBackend().database(); } catch (err) {
      logger.error('Not starting: secrets can\'t be stored', { error: (err as Error).message });
      process.exit(1);
    }
  }
  // A customer-run install makes its company and first admin on first start (install/sign-in.ts).
  if (installSignIn()) {
    try { await bootstrapInstall(); } catch (err) {
      logger.error('Not starting: the install couldn\'t be set up', { error: (err as Error).message });
      process.exit(1);
    }
  }
  // A half-set email setting is a mistake to fix now, not at the first alert.
  try { mailer(); } catch (err) {
    logger.error('Not starting: email settings are incomplete', { error: (err as Error).message });
    process.exit(1);
  }
  const app = await buildApp();
  try {
    await app.listen({ port: PORT, host: HOST });
    logger.info('Gateway service started', { port: PORT });
    scheduleRetention();
    scheduleKeyRotation();
    scheduleLicenseNotices();
    // The AI service catalog: the last one stored, then hourly downloads of the published one (CATALOG_UPDATES=off stops them).
    catalogUpdater().start();
    opsMetrics.start();
    // Sends companies' records to their log destinations. Off only for a gateway that mustn't send (LOG_EXPORT_WORKER=off).
    if (process.env.LOG_EXPORT_WORKER !== 'off') exporter().start();
  } catch (err) {
    logger.error('Failed to start gateway', { error: err });
    process.exit(1);
  }
}

main();
