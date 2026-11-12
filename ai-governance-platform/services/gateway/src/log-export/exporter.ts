import { randomBytes } from 'crypto';
import { collection } from '@ai-governance/storage';
import { AuditLog } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { activityLog, ActivityLog } from '../activity/activity-log';
import { callBackend, EgressError } from '../mcp/egress';
import { buildRequest } from './formats';
import { fromActivity, fromDecision, ExportRecord, RecordChoice } from './records';
import {
  allowPrivateDestinations, Cursor, DEAD_LETTER_DAYS, DeadLetter, Destination, destinationStore, DestinationStore,
  newDeadLetterId, PendingBatch, Source,
} from './destinations';

const logger = createLogger('gateway:log-export');

/**
 * Sends each company's records to its log destinations.
 *
 * Nothing extra is written on the request path: the sender reads records that are already stored (decisions,
 * activity) after each destination's cursor, in batches, and moves the cursor when a batch is delivered.
 * Delivery is at least once. A failed batch is retried with backoff; after the last try it goes to the dead
 * letters (kept 30 days, can be sent again) and the cursor moves on, so one bad batch doesn't stop the rest.
 * A lease on each destination stops two gateways sending the same batch.
 */

export interface ExporterOptions {
  /** How often to look for new records. */
  intervalMs: number;
  /** Records newer than this are left for the next round (writes can land a little out of order). */
  settleMs: number;
  /** First retry after this; doubles each time. */
  retryBaseMs: number;
  maxAttempts: number;
  batchSize: number;
  timeoutMs: number;
}

export function exporterOptionsFromEnv(): ExporterOptions {
  const n = (name: string, fallback: number) => Number(process.env[name]) || fallback;
  return {
    intervalMs: n('LOG_EXPORT_INTERVAL_MS', 10_000),
    settleMs: n('LOG_EXPORT_SETTLE_MS', 30_000),
    retryBaseMs: n('LOG_EXPORT_RETRY_BASE_MS', 30_000),
    maxAttempts: n('LOG_EXPORT_MAX_ATTEMPTS', 5),
    batchSize: Math.min(n('LOG_EXPORT_BATCH_SIZE', 100), 500),
    timeoutMs: n('LOG_EXPORT_TIMEOUT_MS', 10_000),
  };
}

export interface SendResult { ok: boolean; status?: number; ms: number; error?: string; answer?: string }

/** Sends one HTTP request. Swappable in tests. */
export type Transport = (req: { url: string; headers: Record<string, string>; body: string | Buffer; contentType?: string; timeoutMs: number }) => Promise<{ status: number; body: string; ms: number }>;

export const httpTransport: Transport = async (req) => {
  const r = await callBackend({
    url: new URL(req.url), method: 'POST', headers: req.headers, body: req.body, contentType: req.contentType ?? 'application/json',
    timeoutMs: req.timeoutMs, maxBytes: 4096, allowPrivate: allowPrivateDestinations(),
  });
  return { status: r.status, body: r.body, ms: r.ms };
};

const SOURCES_FOR: Record<Source, RecordChoice[]> = { decisions: ['decisions'], activity: ['admin_activity', 'sign_ins'] };
const MAX_BATCH_BYTES = 200_000;

export class Exporter {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  readonly instanceId = `gw_${randomBytes(6).toString('hex')}`;

  constructor(
    private opts: ExporterOptions = exporterOptionsFromEnv(),
    private store: () => DestinationStore = destinationStore,
    private transport: Transport = httpTransport,
    private activity: () => ActivityLog = activityLog,
    private now = () => Date.now(),
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.opts.intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round over every destination. Safe to call concurrently (it skips when a round is running). */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const { tenantId, destinationId } of await this.store().all()) {
        try { await this.runDestination(tenantId, destinationId); } catch (err) {
          logger.error('Log export round failed', { tenantId, destinationId, error: (err as Error).message });
        }
      }
    } catch (err) {
      logger.error('Log export could not list destinations', { error: (err as Error).message });
    } finally {
      this.running = false;
    }
  }

  /** Send what's due for one destination, holding its lease. Several batches when there's a backlog. */
  async runDestination(tenantId: string, destinationId: string, maxBatches = 10): Promise<void> {
    let d = await this.store().get(tenantId, destinationId);
    if (!d || !d.enabled) return;
    const lease = await this.acquire(d);
    if (!lease) return;
    d = lease;
    try {
      for (let i = 0; i < maxBatches; i++) {
        if (d.pending) {
          if (d.pending.nextAttemptAt > this.now()) return;
          const next = await this.deliverPending(d, d.pending);
          if (!next || next.pending) return; // waiting for a retry
          d = next;
          continue;
        }
        const batch = await this.nextBatch(d);
        if (!batch) return;
        if (!batch.records.length) {
          // Only records of types this destination doesn't take: move past them.
          d = (await this.store().update(tenantId, destinationId, { set: { [cursorField(batch.source)]: batch.cursor }, where: { leaseId: this.instanceId } })) ?? d;
          continue;
        }
        const next = await this.deliverPending(d, batch);
        if (!next || next.pending) return;
        d = next;
      }
    } finally {
      await this.store().update(tenantId, destinationId, { set: { leaseId: 'none', leaseUntil: 0 }, where: { leaseId: this.instanceId } }).catch(() => undefined);
    }
  }

  private async acquire(d: Destination): Promise<Destination | null> {
    if (d.leaseId !== 'none' && d.leaseUntil > this.now() && d.leaseId !== this.instanceId) return null;
    return this.store().update(d.tenantId, d.destinationId, {
      set: { leaseId: this.instanceId, leaseUntil: this.now() + Math.max(60_000, this.opts.timeoutMs * 12) },
      where: { leaseId: d.leaseId ?? 'none' },
    });
  }

  /** The next batch from whichever source is furthest behind, or null when there's nothing new. */
  async nextBatch(d: Destination): Promise<PendingBatch | null> {
    const until = new Date(this.now() - this.opts.settleMs).toISOString();
    const wantsDecisions = d.recordTypes.includes('decisions');
    const wantsActivity = d.recordTypes.some((t) => SOURCES_FOR.activity.includes(t));
    const tries: Array<() => Promise<PendingBatch | null>> = [];
    if (wantsDecisions) tries.push(() => this.decisionBatch(d, until));
    if (wantsActivity) tries.push(() => this.activityBatch(d, until));
    for (const t of tries) {
      const b = await t();
      if (b) return b;
    }
    return null;
  }

  private async decisionBatch(d: Destination, until: string): Promise<PendingBatch | null> {
    const cur = d.cursorDecisions;
    if (cur.after >= until) return null;
    const page = await collection<AuditLog & Record<string, unknown>>('auditLogs').query({
      partition: d.tenantId, index: 'tenantId-timestamp-index', range: { between: [cur.after, until] }, order: 'asc', limit: this.opts.batchSize + (cur.ids?.length ?? 0),
    });
    const seen = new Set(cur.ids ?? []);
    const fresh = page.items.filter((l) => !(l.timestamp === cur.after && seen.has(l.requestId))).slice(0, this.opts.batchSize);
    if (!fresh.length) return null;
    const records = capBytes(fresh.map(fromDecision));
    const taken = fresh.slice(0, records.length);
    const last = taken[taken.length - 1].timestamp;
    const ids = taken.filter((l) => l.timestamp === last).map((l) => l.requestId);
    return this.batch('decisions', records, { after: last, ids: last === cur.after ? [...(cur.ids ?? []), ...ids] : ids });
  }

  private async activityBatch(d: Destination, until: string): Promise<PendingBatch | null> {
    const cur = d.cursorActivity;
    const fresh = await this.activity().since(d.tenantId, cur.after, until, this.opts.batchSize);
    if (!fresh.length) return null;
    const wanted = (c: string) => (c === 'sign_in' ? d.recordTypes.includes('sign_ins') : d.recordTypes.includes('admin_activity'));
    const records = capBytes(fresh.filter((r) => wanted(r.category)).map(fromActivity));
    // Move the cursor only past what's sent (and the skipped records before it).
    const lastSent = records.length ? records[records.length - 1].id : null;
    const upto = lastSent ? fresh.findIndex((r) => r.eventId === lastSent) : fresh.length - 1;
    return this.batch('activity', records, { after: fresh[upto].eventKey });
  }

  private batch(source: Source, records: ExportRecord[], cursor: Cursor): PendingBatch {
    return { batchId: `b_${randomBytes(8).toString('hex')}`, source, records, cursor, attempts: 0, firstAttemptAt: new Date(this.now()).toISOString(), nextAttemptAt: 0 };
  }

  /** Try a batch once; returns the destination as stored afterwards. */
  private async deliverPending(d: Destination, batch: PendingBatch): Promise<Destination | null> {
    const result = await this.send(d, batch.records, batch.batchId);
    const at = new Date(this.now()).toISOString();
    const lease = { where: { leaseId: this.instanceId } };
    if (result.ok) {
      return this.store().update(d.tenantId, d.destinationId, {
        ...lease,
        set: { [cursorField(batch.source)]: batch.cursor, lastDeliveredAt: at, lastAttemptAt: at },
        remove: ['pending', 'lastError'],
        increment: { deliveredCount: batch.records.length },
      });
    }
    const attempts = batch.attempts + 1;
    const error = describe(result);
    if (attempts >= this.opts.maxAttempts) {
      const entryId = newDeadLetterId();
      const dl: DeadLetter = {
        tenantId: d.tenantId, recordKey: `dead#${entryId}`, entryId, destinationId: d.destinationId, destinationName: d.name, source: batch.source,
        records: batch.records, count: batch.records.length, error, attempts, firstAttemptAt: batch.firstAttemptAt, lastAttemptAt: at,
        ttl: Math.floor(this.now() / 1000) + DEAD_LETTER_DAYS * 86_400,
      };
      await this.store().addDeadLetter(dl);
      logger.warn('Log export batch moved to dead letters', { tenantId: d.tenantId, destinationId: d.destinationId, count: dl.count, error });
      return this.store().update(d.tenantId, d.destinationId, {
        ...lease,
        set: { [cursorField(batch.source)]: batch.cursor, lastAttemptAt: at, lastError: error },
        remove: ['pending'],
        increment: { deadLetterCount: batch.records.length },
      });
    }
    const pending: PendingBatch = { ...batch, attempts, nextAttemptAt: this.now() + this.opts.retryBaseMs * 2 ** (attempts - 1) };
    logger.info('Log export batch will be retried', { tenantId: d.tenantId, destinationId: d.destinationId, attempts, error });
    return this.store().update(d.tenantId, d.destinationId, { ...lease, set: { pending, lastAttemptAt: at, lastError: error } });
  }

  /** Send records to a destination now (also used by the test button and to resend dead letters). */
  async send(d: Destination, records: ExportRecord[], batchId = `b_${randomBytes(8).toString('hex')}`): Promise<SendResult> {
    const started = this.now();
    try {
      const secrets = await this.store().secrets(d);
      const req = buildRequest({ kind: d.kind, splunkIndex: d.splunkIndex, otlpEncoding: d.otlpEncoding }, secrets, records, batchId, new Date(this.now()));
      const res = await this.transport({ ...req, timeoutMs: this.opts.timeoutMs });
      const answer = res.body.slice(0, 300);
      return res.status >= 200 && res.status < 300 ? { ok: true, status: res.status, ms: res.ms, answer } : { ok: false, status: res.status, ms: res.ms, answer };
    } catch (err) {
      const message = err instanceof EgressError ? err.message.replace(/The API/g, 'The destination').replace(/the API/g, 'the destination') : (err as Error).message;
      return { ok: false, ms: this.now() - started, error: message };
    }
  }
}

const cursorField = (s: Source) => (s === 'decisions' ? 'cursorDecisions' : 'cursorActivity');

export function describe(r: SendResult): string {
  if (r.error) return r.error.slice(0, 300);
  return `The destination answered ${r.status}${r.answer ? `: ${r.answer.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`;
}

/** Keep a batch under the size the record store and most intakes accept. */
function capBytes(records: ExportRecord[]): ExportRecord[] {
  let size = 0;
  const out: ExportRecord[] = [];
  for (const r of records) {
    size += JSON.stringify(r).length;
    if (out.length && size > MAX_BATCH_BYTES) break;
    out.push(r);
  }
  return out;
}

let shared: Exporter | null = null;
export function exporter(): Exporter {
  if (!shared) shared = new Exporter();
  return shared;
}
export function setExporter(e: Exporter | null) {
  shared = e;
}
