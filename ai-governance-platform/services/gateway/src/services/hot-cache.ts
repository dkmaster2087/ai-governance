/**
 * A small in-memory cache for what every AI request reads and admins rarely change (a company's rules, its model
 * settings). Each gateway copy keeps its own: a change made on this copy is seen at once (writes call `forget`),
 * one made on another copy within `ttlMs`. Loads for the same key share one database call.
 */
export class HotCache<T> {
  private entries = new Map<string, { value: Promise<T>; until: number }>();

  /** `keep`: whether a loaded value may be cached (an empty list that may come from a failed read isn't). */
  constructor(private ttlMs: number, private maxEntries = 10_000, private keep: (value: T) => boolean = () => true) {}

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.until > now) return hit.value;
    const value = load();
    this.entries.set(key, { value, until: now + this.ttlMs });
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    try {
      const v = await value;
      if (!this.keep(v) && this.entries.get(key)?.value === value) this.entries.delete(key);
      return v;
    } catch (err) {
      // A failed load isn't kept: the next request tries the database again.
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
      throw err;
    }
  }

  forget(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

/** How long a copy may serve a company's rules or model settings after another copy changed them. */
export function hotCacheTtlMs(): number {
  const v = Number(process.env.HOT_CACHE_TTL_MS);
  if (Number.isFinite(v) && v >= 0) return v;
  // Tests read straight after writing through other paths; keep them exact.
  return process.env.JEST_WORKER_ID ? 0 : 15_000;
}
