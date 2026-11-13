import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:rate');

export interface RateResult { allowed: boolean; count: number; limit: number; remaining: number; retryAfter: number }

/**
 * Calls per minute (or per day), counted in the shared database so every gateway instance sees the same count.
 * One atomic increment per call; the counter expires on its own shortly after its window.
 */
export class RateCounter {
  private warnedAt = 0;

  async hit(tenantId: string, scope: string, limit: number, now = Date.now(), window: 'minute' | 'day' = 'minute'): Promise<RateResult> {
    const d = new Date(now);
    const day = window === 'day';
    const bucket = day ? `d#${d.toISOString().slice(0, 10)}` : `m#${d.toISOString().slice(0, 16)}`;
    const retryAfter = day
      ? Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now) / 1000)
      : 60 - d.getUTCSeconds();
    if (!(limit > 0)) return { allowed: true, count: 0, limit, remaining: 0, retryAfter };
    try {
      const row = await collection<{ tenantId: string; period: string; count?: number }>('metrics').update(
        { tenantId, period: `ratelimit#${scope}#${bucket}` },
        { increment: { count: 1 }, set: { ttl: Math.floor(now / 1000) + (day ? 2 * 86_400 : 180) } },
      );
      const count = row?.count ?? 0;
      return { allowed: count <= limit, count, limit, remaining: Math.max(0, limit - count), retryAfter };
    } catch (err) {
      // A counter that can't be reached never stops traffic on its own (the per-address limit and WAF still apply).
      if (now - this.warnedAt > 60_000) {
        this.warnedAt = now;
        logger.warn('Rate counters unavailable; not limiting', { error: (err as Error).message });
      }
      return { allowed: true, count: 0, limit, remaining: limit, retryAfter };
    }
  }
}

let shared: RateCounter | null = null;
export const rateCounter = () => (shared ??= new RateCounter());
export const setRateCounter = (r: RateCounter | null) => { shared = r; };
