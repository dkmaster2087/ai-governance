import axios from 'axios';
import { CatalogData, catalogInfo, CatalogDataError, CatalogInfo, servicesFromData, setCatalog } from '@ai-governance/catalog';
import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { CatalogDocumentError, MAX_CATALOG_BYTES, verifyCatalogDocument } from './catalog-document';

const logger = createLogger('gateway:catalog');

/**
 * Keeps this install's AI service catalog current (docs/ASSESSMENT.md, "The AI service catalog").
 *
 * - Every hour one request to CATALOG_URL for a public, signed file, the way antivirus definitions are fetched. Nothing
 *   is sent with it: no license key, no install or company name, no counts, a plain user agent. If-None-Match makes
 *   an unchanged catalog a 304. HTTPS_PROXY and NO_PROXY are honoured.
 * - A catalog is applied only if it's signed by a trusted key and newer than the one in use (an older file, replayed,
 *   can't remove services). The last good one is kept in the database, shared by every copy, and each copy re-reads
 *   it every few minutes; without one, the catalog built into the image is used.
 * - CATALOG_UPDATES=off stops the downloads (an admin can still upload a catalog file, e.g. on an air-gapped site);
 *   CATALOG_URL points at a mirror instead.
 */

export const DEFAULT_CATALOG_URL = 'https://probaline.com/api/public/catalog/v1/latest.json';

interface StoredCatalog { tenantId: string; period: string; document?: string; sequence?: number; source?: 'feed' | 'upload'; appliedAt?: string; by?: string }
interface CatalogStatus { tenantId: string; period: string; lastCheckedAt?: string; lastResult?: string; lastError?: string; etag?: string; lastSuccessAt?: string }

const INSTALL = '_install';
const KEY = { tenantId: INSTALL, period: 'catalog#current' };
const STATUS = { tenantId: INSTALL, period: 'catalog#status' };
const store = () => collection<StoredCatalog & CatalogStatus>('metrics');

export interface CatalogState extends CatalogInfo {
  updates: 'auto' | 'off';
  url: string;
  lastCheckedAt?: string;
  lastResult?: string;
  lastError?: string;
  lastSuccessAt?: string;
}

export interface CheckResult {
  result: 'updated' | 'unchanged' | 'not-newer' | 'error';
  message: string;
}

export class CatalogUpdater {
  private checkTimer: NodeJS.Timeout | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  private checking: Promise<CheckResult> | null = null;

  constructor(
    private env: NodeJS.ProcessEnv = process.env,
    private get: (url: string, etag?: string) => Promise<{ status: number; body?: string; etag?: string }> = download,
  ) {}

  updates(): 'auto' | 'off' {
    return (this.env.CATALOG_UPDATES ?? '').toLowerCase() === 'off' ? 'off' : 'auto';
  }

  url(): string {
    return this.env.CATALOG_URL || DEFAULT_CATALOG_URL;
  }

  /** Apply the catalog this install last stored, if it's newer than the one in use. Verified again: the database isn't trusted to sign. */
  async reload(): Promise<boolean> {
    const stored = await store().get(KEY);
    if (!stored?.document || !stored.source) return false;
    try {
      const { data } = verifyCatalogDocument(stored.document);
      return setCatalog(data, stored.source);
    } catch (err) {
      logger.warn('The stored catalog could not be used', { error: (err as Error).message });
      return false;
    }
  }

  /**
   * Verify a signed catalog and, if newer than both the one in use and the one stored, store and apply it.
   * Throws CatalogDocumentError or CatalogDataError when it can't be used.
   */
  async accept(text: string, source: 'feed' | 'upload', by?: string): Promise<CheckResult> {
    const { data } = verifyCatalogDocument(text);
    servicesFromData(data); // throws on malformed contents, before anything is stored
    const current = catalogInfo();
    const stored = await store().get(KEY);
    if (data.sequence <= current.sequence || data.sequence <= (stored?.sequence ?? 0)) {
      return { result: 'not-newer', message: `Catalog ${data.version} is not newer than the one in use (${current.version}).` };
    }
    await store().put({ ...KEY, document: text, sequence: data.sequence, source, appliedAt: new Date().toISOString(), ...(by ? { by } : {}) });
    setCatalog(data, source);
    logger.info('AI service catalog updated', { version: data.version, services: data.services.length, source });
    return { result: 'updated', message: `Now using catalog ${data.version} (${data.services.length} services).` };
  }

  /** Download the published catalog now (one at a time per copy). */
  check(): Promise<CheckResult> {
    if (!this.checking) this.checking = this.doCheck().finally(() => { this.checking = null; });
    return this.checking;
  }

  private async doCheck(): Promise<CheckResult> {
    const status = await store().get(STATUS).catch(() => null);
    const at = new Date().toISOString();
    let outcome: CheckResult;
    let etag = status?.etag;
    try {
      const res = await this.get(this.url(), etag);
      if (res.status === 304) {
        outcome = { result: 'unchanged', message: 'The catalog hasn’t changed since the last check.' };
      } else if (res.status === 200 && res.body !== undefined) {
        outcome = await this.accept(res.body, 'feed');
        etag = res.etag;
      } else {
        outcome = { result: 'error', message: `The catalog address answered ${res.status}.` };
      }
    } catch (err) {
      const known = err instanceof CatalogDocumentError || err instanceof CatalogDataError;
      outcome = { result: 'error', message: known ? (err as Error).message : `Couldn’t download the catalog: ${(err as Error).message}` };
    }
    await store().put({
      ...STATUS, lastCheckedAt: at, lastResult: outcome.result,
      ...(outcome.result === 'error'
        ? { lastError: outcome.message, ...(status?.lastSuccessAt ? { lastSuccessAt: status.lastSuccessAt } : {}) }
        : { lastSuccessAt: at }),
      ...(etag ? { etag } : {}),
    }).catch((err) => logger.warn('Could not record the catalog check', { error: (err as Error).message }));
    if (outcome.result === 'error') logger.warn('Catalog check failed', { message: outcome.message });
    return outcome;
  }

  async state(): Promise<CatalogState> {
    const status = await store().get(STATUS).catch(() => null);
    return {
      ...catalogInfo(),
      updates: this.updates(),
      url: this.url(),
      ...(status?.lastCheckedAt ? { lastCheckedAt: status.lastCheckedAt, lastResult: status.lastResult } : {}),
      ...(status?.lastError && status.lastResult === 'error' ? { lastError: status.lastError } : {}),
      ...(status?.lastSuccessAt ? { lastSuccessAt: status.lastSuccessAt } : {}),
    };
  }

  /** Start: apply the stored catalog, then re-read it every few minutes and, unless off, download every hour. */
  start(): void {
    this.reload().catch((err) => logger.warn('Could not read the stored catalog', { error: (err as Error).message }));
    const reloadMs = Number(this.env.CATALOG_RELOAD_MS) || 5 * 60_000;
    this.reloadTimer = setInterval(() => { this.reload().catch(() => undefined); }, reloadMs);
    this.reloadTimer.unref();
    if (this.updates() === 'off') return;
    const everyMs = (Number(this.env.CATALOG_CHECK_MINUTES) || 60) * 60_000;
    // Spread copies and installs out, so they don't all ask at the same moment.
    const first = 30_000 + Math.floor(Math.random() * 60_000);
    const schedule = (ms: number) => {
      this.checkTimer = setTimeout(() => {
        this.check().catch(() => undefined).finally(() => schedule(everyMs + Math.floor(Math.random() * 5 * 60_000)));
      }, ms);
      this.checkTimer.unref();
    };
    schedule(first);
  }

  stop(): void {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    if (this.reloadTimer) clearInterval(this.reloadTimer);
  }
}

/** A plain GET: no credentials, no identifying headers. axios honours HTTPS_PROXY and NO_PROXY. */
async function download(url: string, etag?: string) {
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
    throw new Error('CATALOG_URL must be an https address');
  }
  const res = await axios.get<string>(url, {
    headers: { 'user-agent': 'Probaline', accept: 'application/json', ...(etag ? { 'if-none-match': etag } : {}) },
    responseType: 'text',
    transformResponse: (x) => x,
    timeout: 20_000,
    maxContentLength: MAX_CATALOG_BYTES,
    maxRedirects: 3,
    validateStatus: () => true,
  });
  return { status: res.status, body: typeof res.data === 'string' ? res.data : undefined, etag: (res.headers.etag as string | undefined) ?? undefined };
}

let shared: CatalogUpdater | null = null;
export const catalogUpdater = () => (shared ??= new CatalogUpdater());
export const setCatalogUpdater = (u: CatalogUpdater | null) => { shared = u; };

export type { CatalogData };
