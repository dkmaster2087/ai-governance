import { gzipSync } from 'zlib';
import { randomBytes } from 'crypto';
import { AuditLog } from '@ai-governance/types';
import { objects } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:archive');

/**
 * The archive copy of case files (S3, or files on disk), written in batches instead of one object per request.
 * Each batch is one gzipped JSON Lines file per company and day, under the same `logs/<company>/<day>/` prefix the
 * retention sweep deletes by. The queryable record in the database is written before the answer as before; only
 * this copy waits, at most `flushMs`.
 *
 * Nothing is dropped: a failed write is kept and retried, and when too much is waiting, requests wait for a write
 * instead of the queue growing (so a slow archive slows the gateway rather than losing evidence). Pending batches
 * are written on shutdown.
 */
export class ArchiveBatcher {
  private pending = new Map<string, string[]>();
  private size = 0;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> | null = null;
  private warnedAt = 0;

  constructor(
    private bucket: () => string,
    private flushMs = Number(process.env.ARCHIVE_FLUSH_MS) || 2000,
    private batchSize = 500,
    private maxWaiting = 20_000,
  ) {}

  /** Queue one case file; resolves at once unless too much is waiting, then after the next write. */
  async add(log: AuditLog): Promise<void> {
    const prefix = `logs/${log.tenantId}/${log.timestamp.slice(0, 10)}/`;
    const lines = this.pending.get(prefix) ?? [];
    lines.push(JSON.stringify(log));
    this.pending.set(prefix, lines);
    this.size++;
    if (this.size >= this.maxWaiting) {
      await this.flush();
      return;
    }
    if (this.size >= this.batchSize) this.flush().catch(() => undefined);
    else this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => undefined);
    }, this.flushMs);
    this.timer.unref?.();
  }

  /** Write everything queued; one call at a time. */
  async flush(): Promise<void> {
    if (this.writing) {
      await this.writing;
      if (this.size === 0) return;
    }
    if (this.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    this.size = 0;
    this.writing = this.write(batch).finally(() => { this.writing = null; });
    return this.writing;
  }

  private async write(batch: Map<string, string[]>): Promise<void> {
    const store = objects(this.bucket(), { kms: true });
    const failed: Array<[string, string[]]> = [];
    await Promise.all([...batch].map(async ([prefix, lines]) => {
      const key = `${prefix}batch-${Date.now()}-${randomBytes(4).toString('hex')}.jsonl.gz`;
      try {
        await store.put(key, gzipSync(`${lines.join('\n')}\n`), 'application/gzip');
      } catch (err) {
        failed.push([prefix, lines]);
        if (Date.now() - this.warnedAt > 60_000) {
          this.warnedAt = Date.now();
          logger.error('Archive copy of case files failed; will retry', { records: lines.length, error: (err as Error).message });
        }
      }
    }));
    // Put failed lines back in front, and try again on the next tick.
    for (const [prefix, lines] of failed) {
      this.pending.set(prefix, [...lines, ...(this.pending.get(prefix) ?? [])]);
      this.size += lines.length;
    }
    if (failed.length) this.schedule();
  }
}

let shared: ArchiveBatcher | null = null;
export const archiveBatcher = () => (shared ??= new ArchiveBatcher(() => process.env.AUDIT_LOG_BUCKET || 'ai-governance-audit-logs'));
export const setArchiveBatcher = (b: ArchiveBatcher | null) => { shared = b; };
