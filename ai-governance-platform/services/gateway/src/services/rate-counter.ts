import { createLogger } from '@ai-governance/utils';
import { BatchedCounter } from './batched-counter';

const logger = createLogger('gateway:rate');

export interface RateResult { allowed: boolean; count: number; limit: number; remaining: number; retryAfter: number }

/** Limits this small are always counted exactly (a write per call); larger ones are batched until they're close. */
const EXACT_UP_TO = 100;
/** Within this share of the limit, every call is counted exactly so the cut-off is precise. */
const EXACT_FROM = 0.9;

/**
 * Calls per minute (or any period), shared by every gateway instance through the database. Far from the limit,
 * each copy adds up locally and writes once a second; close to it, or for small limits, every call is written so
 * the count is exact. Calls already refused this period aren't counted again. If the counters can't be reached,
 * traffic isn't stopped by them (the per-address limit and the web firewall still apply).
 */
export class RateCounter {
  private warnedAt = 0;

  constructor(private counter = new BatchedCounter()) {}

  /** Counts one call against `limit` for the period named by `key`; `ttlSeconds` keeps the counter a while after. */
  async count(tenantId: string, key: string, limit: number, ttlSeconds: number): Promise<{ allowed: boolean; count: number }> {
    if (!(limit > 0)) return { allowed: true, count: 0 };
    try {
      const known = this.counter.estimate(tenantId, key);
      // Already over: refuse without another write.
      if (known !== null && known > limit) return { allowed: false, count: known };
      const exact = limit <= EXACT_UP_TO || (known !== null && known + 1 >= limit * EXACT_FROM);
      const count = exact ? await this.counter.addNow(tenantId, key, 1, ttlSeconds) : await this.counter.add(tenantId, key, 1, ttlSeconds);
      return { allowed: count <= limit, count };
    } catch (err) {
      const now = Date.now();
      if (now - this.warnedAt > 60_000) {
        this.warnedAt = now;
        logger.warn('Rate counters unavailable; not limiting', { error: (err as Error).message });
      }
      return { allowed: true, count: 0 };
    }
  }

  async hit(tenantId: string, scope: string, limit: number, now = Date.now()): Promise<RateResult> {
    const minute = new Date(now).toISOString().slice(0, 16);
    const retryAfter = 60 - new Date(now).getUTCSeconds();
    if (!(limit > 0)) return { allowed: true, count: 0, limit, remaining: 0, retryAfter };
    const r = await this.count(tenantId, `ratelimit#${scope}#m#${minute}`, limit, 180);
    if (r.count === 0 && r.allowed) return { allowed: true, count: 0, limit, remaining: limit, retryAfter };
    return { allowed: r.allowed, count: r.count, limit, remaining: Math.max(0, limit - r.count), retryAfter };
  }

  /** Write anything pending (on shutdown). */
  flush(): Promise<void> {
    return this.counter.flush();
  }
}

let shared: RateCounter | null = null;
export const rateCounter = () => (shared ??= new RateCounter());
export const setRateCounter = (r: RateCounter | null) => { shared = r; };
