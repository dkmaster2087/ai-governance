import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:counters');

/**
 * Shared counters (rate limits, alert windows, spend) without a database write per request. Each gateway copy adds
 * up locally and writes the sum once a second, with one atomic increment per counter; the database's answer is the
 * total across every copy. Callers that need an exact total right now (a small limit, or close to it) use
 * `addNow`, which writes straight away.
 */

interface Slot {
  tenantId: string;
  period: string;
  ttlSeconds: number;
  /** Added on this copy and not yet written. */
  pending: number;
  /** The total the database last reported (null until this copy has written once). */
  synced: number | null;
  /** Called after each write with the new total and how much that write added (one handler per counter). */
  onWritten?: (total: number, added: number) => void | Promise<void>;
  writing?: Promise<void>;
  lastUsed: number;
}

export class BatchedCounter {
  private slots = new Map<string, Slot>();
  private timer: NodeJS.Timeout | null = null;
  private warnedAt = 0;

  /** `flushMs` 0 writes every add straight away (the default in tests, so they read exact counts). */
  constructor(private flushMs = defaultFlushMs()) {}

  private slot(tenantId: string, period: string, ttlSeconds: number): Slot {
    const key = `${tenantId}\u0000${period}`;
    let s = this.slots.get(key);
    if (!s) {
      s = { tenantId, period, ttlSeconds, pending: 0, synced: null, lastUsed: Date.now() };
      this.slots.set(key, s);
    }
    s.lastUsed = Date.now();
    s.ttlSeconds = ttlSeconds;
    return s;
  }

  private schedule() {
    if (this.timer || this.flushMs <= 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => undefined);
    }, this.flushMs);
    this.timer.unref?.();
  }

  /** Write one counter's pending sum now; resolves when the database has answered. */
  private write(s: Slot): Promise<void> {
    if (s.writing) return s.writing.then(() => (s.pending > 0 ? this.write(s) : undefined));
    const added = s.pending;
    if (added === 0 && s.synced !== null) return Promise.resolve();
    s.pending = 0;
    s.writing = (async () => {
      try {
        const row = await collection<{ tenantId: string; period: string; count?: number }>('metrics').update(
          { tenantId: s.tenantId, period: s.period },
          { increment: { count: added }, set: { ttl: Math.floor(Date.now() / 1000) + s.ttlSeconds } },
        );
        s.synced = row?.count ?? (s.synced ?? 0) + added;
      } catch (err) {
        s.pending += added;
        throw err;
      } finally {
        s.writing = undefined;
      }
      // The count is written; a failing handler (an alert that couldn't be sent) must not count it again.
      if (added > 0 && s.onWritten) {
        try {
          await s.onWritten(s.synced, added);
        } catch (err) {
          logger.warn('Counter handler failed', { period: s.period, error: (err as Error).message });
        }
      }
    })();
    return s.writing;
  }

  /** Adds `n` and returns this copy's best estimate of the total. The first use of a counter waits for the database. */
  async add(tenantId: string, period: string, n: number, ttlSeconds: number): Promise<number> {
    const s = this.slot(tenantId, period, ttlSeconds);
    s.pending += n;
    if (s.synced === null || this.flushMs <= 0) {
      await this.write(s);
      return s.synced! + s.pending;
    }
    this.schedule();
    return s.synced + s.pending;
  }

  /** Adds `n` and writes now: returns the exact total across every copy. */
  async addNow(tenantId: string, period: string, n: number, ttlSeconds: number): Promise<number> {
    const s = this.slot(tenantId, period, ttlSeconds);
    s.pending += n;
    await this.write(s);
    return s.synced! + s.pending;
  }

  /** The best estimate of a counter's total without adding to it, or null if this copy hasn't seen it. */
  estimate(tenantId: string, period: string): number | null {
    const s = this.slots.get(`${tenantId}\u0000${period}`);
    return s && s.synced !== null ? s.synced + s.pending : null;
  }

  /**
   * Adds `n` to be written with the next batch; `onWritten` runs after that write with the new total and the
   * amount it added, so a threshold is crossed by exactly one write across every copy.
   */
  addLater(tenantId: string, period: string, n: number, ttlSeconds: number, onWritten: Slot['onWritten']): Promise<void> {
    const s = this.slot(tenantId, period, ttlSeconds);
    s.pending += n;
    s.onWritten = onWritten;
    if (this.flushMs <= 0) return this.write(s);
    this.schedule();
    return Promise.resolve();
  }

  /** Write everything pending (every second, and on shutdown). Counters idle for two minutes are dropped. */
  async flush(): Promise<void> {
    const now = Date.now();
    const work: Promise<void>[] = [];
    for (const [key, s] of this.slots) {
      if (s.pending > 0) work.push(this.write(s));
      else if (!s.writing && now - s.lastUsed > 120_000) this.slots.delete(key);
    }
    const results = await Promise.allSettled(work);
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) {
      if (now - this.warnedAt > 60_000) {
        this.warnedAt = now;
        logger.warn('Counters could not be written; will retry', { failed: failed.length, error: (failed[0].reason as Error)?.message });
      }
      this.schedule();
    }
  }
}

function defaultFlushMs(): number {
  const raw = process.env.COUNTER_FLUSH_MS;
  const v = Number(raw);
  if (raw && Number.isFinite(v) && v >= 0) return v;
  return process.env.JEST_WORKER_ID ? 0 : 1000;
}

let shared: BatchedCounter | null = null;
export const batchedCounter = () => (shared ??= new BatchedCounter());
export const setBatchedCounter = (c: BatchedCounter | null) => { shared = c; };
