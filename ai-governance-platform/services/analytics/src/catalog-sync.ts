import { setCatalog } from '@ai-governance/catalog';
import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('analytics:catalog');

/**
 * Reports name AI tools from the catalog. The gateway downloads, verifies and stores the published catalog
 * (services/gateway/src/catalog); reports read the stored one every few minutes so their names match. The gateway
 * verified its signature before storing it, and only the gateway writes it.
 */
export async function loadStoredCatalog(): Promise<boolean> {
  const stored = await collection<{ tenantId: string; period: string; document?: string; source?: 'feed' | 'upload' }>('metrics')
    .get({ tenantId: '_install', period: 'catalog#current' });
  if (!stored?.document || !stored.source) return false;
  const doc = JSON.parse(stored.document) as { payload?: string };
  if (typeof doc.payload !== 'string') return false;
  return setCatalog(JSON.parse(Buffer.from(doc.payload, 'base64url').toString('utf8')), stored.source);
}

export function syncCatalog(everyMs = Number(process.env.CATALOG_RELOAD_MS) || 5 * 60_000): () => void {
  const run = () => loadStoredCatalog().catch((err) => logger.warn('Could not read the stored catalog', { error: (err as Error).message }));
  run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
