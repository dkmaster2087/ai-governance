import { serviceForDomain } from '@ai-governance/catalog';
import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { callBackend } from '../../mcp/egress';
import { BedrockClassifierModel, ClassifierModel, PageSummary, classify, readHomePage } from './classifier';
import { Candidate, work } from './catalog-work';
import { DiscoverySource, SOURCES, candidateDomain } from './sources';

const logger = createLogger('gateway:catalog-discovery');

/**
 * Finds new AI services for the catalog (Cloud only, CATALOG_DISCOVERY=on). Every ten minutes one gateway copy reads
 * the sources that are due, adds domains nobody has seen to the review queue, and asks the classifier about a few
 * new ones (CATALOG_CLASSIFY_PER_RUN, default 20). People approve or reject on the Catalog page; nothing is published
 * without them.
 */
export const isDiscoveryOn = () => (process.env.CATALOG_DISCOVERY ?? '').toLowerCase() === 'on';

export interface DiscoveryDeps {
  sources?: DiscoverySource[];
  get?: (url: string) => Promise<unknown>;
  model?: ClassifierModel | null;
  readPage?: (domain: string) => Promise<PageSummary>;
  now?: () => Date;
  classifyLimit?: number;
}

export interface DiscoveryResult { sources: Array<{ name: string; found: number; added: number; error?: string }>; classified: number; dismissed: number; failed: number }

/** A public feed can be large (models.dev lists every model: about 6 MB in late 2026). */
const MAX_FEED_BYTES = 40_000_000;

/** A public JSON feed, fetched without credentials (internal addresses refused, 40 MB, 30 s). */
async function getJson(url: string): Promise<unknown> {
  const res = await callBackend({ url: new URL(url), method: 'GET', maxBytes: MAX_FEED_BYTES, timeoutMs: 30_000, redirects: 2, allowPrivate: false,
    headers: { accept: 'application/json', 'user-agent': 'Probaline catalog (+https://probaline.com)' } });
  if (res.status !== 200) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  if (res.truncated) throw new Error(`${new URL(url).hostname} sent more than ${MAX_FEED_BYTES / 1_000_000} MB`);
  return JSON.parse(res.body);
}

/** Retry a failed classification at most once a day. */
const RETRY_MS = 24 * 3600_000;

export async function runDiscovery(deps: DiscoveryDeps = {}, force = false): Promise<DiscoveryResult> {
  const now = deps.now ?? (() => new Date());
  const get = deps.get ?? getJson;
  const result: DiscoveryResult = { sources: [], classified: 0, dismissed: 0, failed: 0 };

  for (const source of deps.sources ?? SOURCES) {
    const prev = await work.run(source.name);
    const at = now();
    if (!force && prev && at.getTime() - Date.parse(prev.lastRunAt) < source.everyMinutes * 60_000) continue;
    const since = prev ? new Date(Date.parse(prev.lastRunAt)) : new Date(at.getTime() - 24 * 3600_000);
    try {
      const raw = await source.run(get, since);
      let added = 0;
      for (const r of raw) {
        const domain = candidateDomain(r.host);
        // Already in the catalog (the host itself or its domain), or not a reviewable domain.
        if (!domain || serviceForDomain(r.host) || serviceForDomain(domain)) continue;
        const existing = await work.candidate(domain);
        const seen = { source: source.name, ...(r.title ? { title: r.title.slice(0, 200) } : {}), ...(r.url ? { url: r.url.slice(0, 500) } : {}), at: at.toISOString() };
        if (existing) {
          if (!existing.sources.some((s) => s.source === source.name && s.url === seen.url)) existing.sources = [seen, ...existing.sources].slice(0, 10);
          existing.lastSeenAt = at.toISOString();
          await work.putCandidate(existing);
        } else {
          await work.putCandidate({ domain, status: 'new', sources: [seen], ...(r.hint ? { hint: r.hint } : {}), firstSeenAt: at.toISOString(), lastSeenAt: at.toISOString() });
          added++;
        }
      }
      await work.putRun({ name: source.name, lastRunAt: at.toISOString(), lastResult: 'ok', found: raw.length, added });
      result.sources.push({ name: source.name, found: raw.length, added });
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      await work.putRun({ name: source.name, lastRunAt: at.toISOString(), lastResult: 'error', found: 0, added: 0, lastError: message });
      result.sources.push({ name: source.name, found: 0, added: 0, error: message });
      logger.warn('Catalog source failed', { source: source.name, error: message });
    }
  }

  const model = deps.model === undefined ? defaultModel() : deps.model;
  if (!model) return result;
  const t = now().getTime();
  const due = (await work.candidates())
    .filter((c) => c.status === 'new' && (!c.classifyError || !c.classifyTriedAt || t - Date.parse(c.classifyTriedAt) > RETRY_MS))
    .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt))
    .slice(0, deps.classifyLimit ?? (Number(process.env.CATALOG_CLASSIFY_PER_RUN) || 20));
  for (const c of due) {
    const outcome = await classifyCandidate(c, model, deps.readPage ?? readHomePage);
    if (outcome === 'dismissed') result.dismissed++;
    else if (outcome === 'classified') result.classified++;
    else result.failed++;
  }
  return result;
}

/** Classify one candidate: a confident "not AI" is set aside (dismissed, still visible); anything else waits for a person. */
export async function classifyCandidate(c: Candidate, model: ClassifierModel, readPage: (d: string) => Promise<PageSummary> = readHomePage): Promise<'classified' | 'dismissed' | 'failed'> {
  try {
    const suggestion = await classify(c.domain, await readPage(c.domain), model, c.hint);
    const dismissed = !suggestion.isAiService && suggestion.confidence >= 0.8;
    const { classifyError: _e, classifyTriedAt: _t, ...rest } = c;
    await work.putCandidate({ ...rest, status: dismissed ? 'dismissed' : 'classified', suggestion });
    return dismissed ? 'dismissed' : 'classified';
  } catch (err) {
    await work.putCandidate({ ...c, classifyError: (err as Error).message.slice(0, 300), classifyTriedAt: new Date().toISOString() });
    return 'failed';
  }
}

let model: ClassifierModel | null | undefined;
/** The classifier, unless switched off (CATALOG_CLASSIFIER=off): then candidates wait for a person unclassified. */
export function defaultModel(): ClassifierModel | null {
  if (model === undefined) model = (process.env.CATALOG_CLASSIFIER ?? '').toLowerCase() === 'off' ? null : new BedrockClassifierModel();
  return model;
}
export const setClassifierModel = (m: ClassifierModel | null | undefined) => { model = m; };

/** Every ten minutes, one copy (the one that claims the slot) runs discovery. */
export function scheduleDiscovery(): NodeJS.Timeout | null {
  if (!isDiscoveryOn()) return null;
  const tick = async () => {
    const slot = Math.floor(Date.now() / 600_000);
    const claimed = await collection('metrics').put({ tenantId: '_catalog', period: `discovery#${slot}`, ttl: Math.floor(Date.now() / 1000) + 3600 }, { ifNotExists: true }).catch(() => false);
    if (!claimed) return;
    const r = await runDiscovery();
    logger.info('Catalog discovery ran', { sources: r.sources.length, added: r.sources.reduce((n, s) => n + s.added, 0), classified: r.classified, dismissed: r.dismissed, failed: r.failed });
  };
  const timer = setInterval(() => { tick().catch((err) => logger.warn('Catalog discovery failed', { error: (err as Error).message })); }, 600_000);
  timer.unref();
  setTimeout(() => { tick().catch(() => undefined); }, 60_000).unref();
  return timer;
}
