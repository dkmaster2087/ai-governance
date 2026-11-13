import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:key-spend');

/**
 * Daily caps per API key: tokens and estimated spend (USD) per UTC day. They stop a leaked key, or an agent stuck
 * in a loop, from running up a bill while staying under the per-minute limit.
 *
 * - Before an AI request, the key's running totals for today are read; at or over a cap, the request is refused.
 * - After the answer, its tokens and estimated cost are added (atomic increments in the shared database, so every
 *   gateway copy sees the same totals).
 * The request that crosses a cap still completes: the cap is checked before, and the size of an answer isn't
 * known until it's back. Keys without caps cost nothing extra.
 */

export interface SpendCaps { dailyTokenLimit?: number; dailySpendLimitUsd?: number }
export interface SpendToday { tokens: number; spendUsd: number }

const day = (now: number) => new Date(now).toISOString().slice(0, 10);
const period = (keyId: string, now: number) => `keyspend#${keyId}#${day(now)}`;
/** Spend is counted in millionths of a dollar, so increments stay whole numbers. */
const MICRO = 1_000_000;

export const hasCaps = (c: SpendCaps | undefined): c is SpendCaps => !!c && ((c.dailyTokenLimit ?? 0) > 0 || (c.dailySpendLimitUsd ?? 0) > 0);

export class KeySpend {
  /** Keys with caps seen recently by this copy: only their usage is counted. */
  private capped = new Map<string, number>();
  private warnedAt = 0;

  remember(keyId: string) {
    if (this.capped.size > 10_000) this.capped.clear();
    this.capped.set(keyId, Date.now());
  }

  async today(tenantId: string, keyId: string, now = Date.now()): Promise<SpendToday> {
    const row = await collection<{ tenantId: string; period: string; tokens?: number; micros?: number }>('metrics').get({ tenantId, period: period(keyId, now) });
    return { tokens: row?.tokens ?? 0, spendUsd: (row?.micros ?? 0) / MICRO };
  }

  /** Why this key may not make another AI request today, or null. A counter that can't be read never stops traffic. */
  async refusal(tenantId: string, keyId: string, caps: SpendCaps, now = Date.now()): Promise<string | null> {
    this.remember(keyId);
    let used: SpendToday;
    try { used = await this.today(tenantId, keyId, now); } catch (err) {
      this.warn(err);
      return null;
    }
    if (caps.dailyTokenLimit && used.tokens >= caps.dailyTokenLimit) {
      return `This key has used its ${caps.dailyTokenLimit.toLocaleString('en-US')} tokens for today. It resets at midnight UTC.`;
    }
    if (caps.dailySpendLimitUsd && used.spendUsd >= caps.dailySpendLimitUsd) {
      return `This key has reached its $${caps.dailySpendLimitUsd.toLocaleString('en-US')} spending limit for today. It resets at midnight UTC.`;
    }
    return null;
  }

  /** Add an answer's tokens and estimated cost to the key's totals for today, if the key has caps. */
  async record(tenantId: string, keyId: string | undefined, tokens: number, costUsd: number, now = Date.now()): Promise<void> {
    if (!keyId || !this.capped.has(keyId) || (tokens <= 0 && costUsd <= 0)) return;
    try {
      await collection('metrics').update(
        { tenantId, period: period(keyId, now) },
        { increment: { tokens: Math.max(0, Math.round(tokens)), micros: Math.max(0, Math.round(costUsd * MICRO)) }, set: { ttl: Math.floor(now / 1000) + 3 * 86_400 } },
      );
    } catch (err) {
      this.warn(err);
    }
  }

  private warn(err: unknown) {
    if (Date.now() - this.warnedAt < 60_000) return;
    this.warnedAt = Date.now();
    logger.warn('Key spending counters unavailable; not enforcing daily caps', { error: (err as Error).message });
  }
}

let shared: KeySpend | null = null;
export const keySpend = () => (shared ??= new KeySpend());
export const setKeySpend = (k: KeySpend | null) => { shared = k; };
