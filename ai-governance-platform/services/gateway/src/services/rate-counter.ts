import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:rate');

export interface RateResult { allowed: boolean; count: number; limit: number; remaining: number; retryAfter: number }

/**
 * Calls per minute, counted in the shared database so every gateway instance sees the same count. One atomic
 * increment per call; the counter expires on its own a few minutes later.
 */
export class RateCounter {
  private warnedAt = 0;

  async hit(tenantId: string, scope: string, limit: number, now = Date.now()): Promise<RateResult> {
    const minute = new Date(now).toISOString().slice(0, 16);
    const retryAfter = 60 - new Date(now).getUTCSeconds();
    if (!(limit > 0)) return { allowed: true, count: 0, limit, remaining: 0, retryAfter };
    try {
      const row = await collection<{ tenantId: string; period: string; count?: number }>('metrics').update(
        { tenantId, period: `ratelimit#${scope}#m#${minute}` },
        { increment: { count: 1 }, set: { ttl: Math.floor(now / 1000) + 180 } },
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
