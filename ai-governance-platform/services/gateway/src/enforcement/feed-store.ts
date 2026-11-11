import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Category } from '@ai-governance/catalog';
import { collection } from '@ai-governance/storage';

/**
 * AI-domain feeds. Firewalls fetch them without signing in, so each has a long random token in its URL. Only a
 * hash of the token is kept; a lost token is replaced by rotating it.
 */
export interface Feed {
  tenantId: string;
  recordKey: string; // feed#<feedId>
  feedId: string;
  name: string;
  categories: Category[];
  tokenHash: string;
  tokenHint: string;
  createdAt: string;
  createdBy?: string;
  updatedAt: string;
  lastFetchedAt?: string;
  lastFetchedFrom?: string;
  lastFetchedFormat?: string;
  lastFetchedAgent?: string;
  fetchCount?: number;
}

export const MAX_FEEDS = 10;
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** A token is `<feedId>.<secret>`, so a fetch finds its feed with one read. */
export function newToken(feedId: string): { token: string; tokenHash: string; tokenHint: string } {
  const secret = randomBytes(32).toString('base64url');
  return { token: `${feedId}.${secret}`, tokenHash: hash(secret), tokenHint: secret.slice(-4) };
}

export function parseToken(token: string): { feedId: string; secret: string } | null {
  const m = /^(fd[a-z0-9]{10,40})\.([A-Za-z0-9_-]{40,60})$/.exec(token);
  return m ? { feedId: m[1], secret: m[2] } : null;
}

export const newFeedId = () => `fd${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;

export class FeedStore {
  private records = () => collection<Record<string, any>>('enforcement');

  async list(tenantId: string): Promise<Feed[]> {
    const page = await this.records().query({ partition: tenantId, range: { beginsWith: 'feed#' }, limit: 50 });
    return page.items as Feed[];
  }

  async get(tenantId: string, feedId: string): Promise<Feed | null> {
    return (await this.records().get({ tenantId, recordKey: `feed#${feedId}` })) as Feed | null;
  }

  async create(feed: Feed): Promise<void> {
    await this.records().put(feed as unknown as Record<string, any>, { ifNotExists: true });
  }

  async update(tenantId: string, feedId: string, set: Partial<Feed>): Promise<Feed | null> {
    return (await this.records().update({ tenantId, recordKey: `feed#${feedId}` }, { set: { ...set, updatedAt: new Date().toISOString() }, ifExists: true })) as Feed | null;
  }

  async remove(tenantId: string, feedId: string): Promise<void> {
    await this.records().delete({ tenantId, recordKey: `feed#${feedId}` });
  }

  /** The feed a token opens, or null. Same answer for a wrong tenant, an unknown feed and a wrong secret. */
  async open(tenantId: string, token: string): Promise<Feed | null> {
    const t = parseToken(token);
    if (!t || !/^[A-Za-z0-9_-]{1,128}$/.test(tenantId)) return null;
    const feed = await this.get(tenantId, t.feedId);
    if (!feed) return null;
    const a = Buffer.from(hash(t.secret), 'hex');
    const b = Buffer.from(feed.tokenHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b) ? feed : null;
  }

  /** Remember the latest fetch, so the dashboard shows which firewall fetched it and when. */
  async recordFetch(feed: Feed, fetch: { from: string; format: string; agent?: string }): Promise<void> {
    await this.records().update({ tenantId: feed.tenantId, recordKey: feed.recordKey }, {
      set: {
        lastFetchedAt: new Date().toISOString(), lastFetchedFrom: fetch.from.slice(0, 64), lastFetchedFormat: fetch.format,
        ...(fetch.agent ? { lastFetchedAgent: fetch.agent.slice(0, 120) } : {}),
      },
      increment: { fetchCount: 1 },
      ifExists: true,
    });
  }

  async getSettings<T>(tenantId: string, name: string): Promise<T | null> {
    const r = await this.records().get({ tenantId, recordKey: `${name}#settings` });
    return (r?.settings as T) ?? null;
  }

  async saveSettings(tenantId: string, name: string, settings: object, by?: string): Promise<void> {
    await this.records().put({ tenantId, recordKey: `${name}#settings`, settings, updatedAt: new Date().toISOString(), ...(by ? { updatedBy: by } : {}) });
  }
}

let shared: FeedStore | null = null;
export const feedStore = () => (shared ??= new FeedStore());
export const setFeedStore = (s: FeedStore | null) => { shared = s; };
