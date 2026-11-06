import { createHash, randomUUID } from 'crypto';
import { collection, objects } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:activity');

/**
 * Who did what in a company's Probaline: admin changes and sign-ins. One durable record each, kept in the
 * record store (queryable, shown on the Activity page, sent by log export) and copied to the audit bucket
 * (S3 with Object Lock in AWS), with a SHA-256 of the record so a changed copy can be spotted.
 */

export type ActivityCategory = 'admin' | 'sign_in';
/** success: it happened. denied: refused for lack of permission or bad credentials. failure: it broke. */
export type ActivityOutcome = 'success' | 'denied' | 'failure';

export interface Actor {
  /** user: dashboard user. api_key: a machine key. person: someone signing in to MCP servers. */
  type: 'user' | 'api_key' | 'person' | 'system';
  id: string;
  email?: string;
  role?: string;
  keyId?: string;
}

export interface ActivityInput {
  tenantId: string;
  category: ActivityCategory;
  /** Dotted, stable name: `rule.created`, `api_key.revoked`, `sign_in.dashboard`… */
  action: string;
  outcome: ActivityOutcome;
  actor: Actor;
  /** IDs of what was acted on (route parameters, the created record's ID). Never request bodies. */
  target?: Record<string, string>;
  requestId?: string;
  sourceIp?: string;
  userAgent?: string;
  /** Short extra facts: an error code, an HTTP status. */
  detail?: Record<string, string | number | boolean>;
  time?: string;
  /** A fixed ID makes the write idempotent (one record however many times it's attempted). */
  eventId?: string;
}

export interface ActivityRecord extends Required<Pick<ActivityInput, 'tenantId' | 'category' | 'action' | 'outcome' | 'actor'>> {
  eventKey: string;
  eventId: string;
  time: string;
  target?: Record<string, string>;
  requestId?: string;
  sourceIp?: string;
  userAgent?: string;
  detail?: Record<string, string | number | boolean>;
  /** SHA-256 of the record without this field and `ttl`. */
  hash: string;
  ttl: number;
}

export const ACTIVITY_RETENTION_DAYS = Number(process.env.ACTIVITY_RETENTION_DAYS) || 400;

const clip = (v: string | undefined, n: number) => (v === undefined ? undefined : v.slice(0, n));

/** Canonical JSON (sorted keys) so the hash doesn't depend on field order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().filter((k) => (value as any)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function recordHash(record: Omit<ActivityRecord, 'hash' | 'ttl'> | ActivityRecord): string {
  const { hash: _h, ttl: _t, ...rest } = record as ActivityRecord;
  return createHash('sha256').update(canonical(rest)).digest('hex');
}

export function buildRecord(input: ActivityInput, retentionDays = ACTIVITY_RETENTION_DAYS): ActivityRecord {
  const time = input.time ?? new Date().toISOString();
  const eventId = input.eventId ?? `act_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const base = {
    tenantId: input.tenantId,
    eventKey: `${time}#${eventId}`,
    eventId,
    time,
    category: input.category,
    action: input.action,
    outcome: input.outcome,
    actor: Object.fromEntries(Object.entries(input.actor).filter(([, v]) => v !== undefined)) as Actor,
    ...(input.target && Object.keys(input.target).length ? { target: input.target } : {}),
    ...(input.requestId ? { requestId: clip(input.requestId, 100) } : {}),
    ...(input.sourceIp ? { sourceIp: clip(input.sourceIp, 64) } : {}),
    ...(input.userAgent ? { userAgent: clip(input.userAgent, 200) } : {}),
    ...(input.detail && Object.keys(input.detail).length ? { detail: input.detail } : {}),
  };
  return { ...base, hash: recordHash(base), ttl: Math.floor(Date.parse(time) / 1000) + retentionDays * 86_400 };
}

export interface ActivityQuery {
  from?: string;
  to?: string;
  category?: ActivityCategory;
  outcome?: ActivityOutcome;
  limit?: number;
  after?: string;
}

export class ActivityLog {
  private bucket = process.env.AUDIT_LOG_BUCKET || 'ai-governance-audit-logs';
  private store = () => collection<ActivityRecord & Record<string, unknown>>('activity');

  /** Record an event. Never throws: activity must not break the request that caused it. */
  async record(input: ActivityInput): Promise<ActivityRecord | null> {
    try {
      const rec = buildRecord(input);
      const written = await this.store().put(rec as ActivityRecord & Record<string, unknown>, { ifNotExists: !!input.eventId });
      if (!written) return null; // already recorded (idempotent event)
      await objects(this.bucket, { kms: true })
        .put(`activity/${rec.tenantId}/${rec.time.slice(0, 10)}/${rec.eventId}.json`, JSON.stringify(rec), 'application/json')
        .catch((err) => logger.warn('Activity archive copy failed', { tenantId: rec.tenantId, eventId: rec.eventId, error: (err as Error).message }));
      return rec;
    } catch (err) {
      logger.error('Failed to record activity', { tenantId: input.tenantId, action: input.action, error: (err as Error).message });
      return null;
    }
  }

  /** A tenant's activity, newest first. Filters apply within each page, so a page can be short. */
  async list(tenantId: string, q: ActivityQuery = {}): Promise<{ items: ActivityRecord[]; next?: string }> {
    const from = q.from ?? '0000';
    const to = q.to ?? '9999';
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const items: ActivityRecord[] = [];
    // The cursor is a record key; each read takes keys strictly before it (`between` includes the bound).
    let upper = q.after ?? `${to}\uffff`;
    let exhausted = false;
    for (let round = 0; round < 10 && items.length < limit && !exhausted; round++) {
      const page = await this.store().query({ partition: tenantId, range: { between: [from, upper] }, order: 'desc', limit: 200 });
      const fresh = page.items.filter((r) => r.eventKey !== upper);
      if (!page.next) exhausted = true;
      for (const r of fresh) {
        upper = r.eventKey;
        if ((q.category && r.category !== q.category) || (q.outcome && r.outcome !== q.outcome)) continue;
        items.push(r);
        if (items.length >= limit) break;
      }
      if (!fresh.length) exhausted = true;
    }
    const full = items.length >= limit;
    const next = full ? items[items.length - 1].eventKey : exhausted ? undefined : upper;
    return { items, ...(next ? { next } : {}) };
  }

  /** Records after a sort position, oldest first (log export reads with this). */
  async since(tenantId: string, afterKey: string, until: string, limit: number): Promise<ActivityRecord[]> {
    const page = await this.store().query({ partition: tenantId, range: { between: [afterKey, `${until}￿`] }, order: 'asc', limit: limit + 1 });
    return page.items.filter((r) => r.eventKey > afterKey && r.time <= until).slice(0, limit);
  }
}

let shared: ActivityLog | null = null;
export function activityLog(): ActivityLog {
  if (!shared) shared = new ActivityLog();
  return shared;
}
export function setActivityLog(log: ActivityLog | null) {
  shared = log;
}
