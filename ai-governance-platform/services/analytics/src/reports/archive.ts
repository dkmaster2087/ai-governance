import { objects } from '@ai-governance/storage';
import { AuditLog } from '@ai-governance/types';

/**
 * Reading audit records older than the database window from the archive copy.
 *
 * The gateway files one JSON object per record under `logs/<tenant>/<day written>/<requestId>-<ms>.json` in the
 * archive: S3 on AWS, MinIO or another S3-compatible store, or a directory on disk on-premises (OBJECT_STORE).
 * The database keeps only the recent window (AUDIT_DB_DAYS), so anything older is read here, a day folder at a
 * time. That is slower than the database, by design.
 */

const DAY = 86_400_000;
const PARALLEL_READS = 16;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const store = () => objects(process.env.AUDIT_LOG_BUCKET || 'ai-governance-audit-logs', { kms: true });

export function databaseDays(): number {
  const d = Number(process.env.AUDIT_DB_DAYS);
  return d > 0 ? d : 90;
}

export const archiveEnabled = () => (process.env.OBJECT_STORE || 's3').toLowerCase() !== 'none';

/**
 * Records at or after this time are read from the database; older ones from the archive.
 * One day earlier than the window itself, because the gateway keeps records two days past it.
 * Null without an archive: the database then holds every record for the full retention period.
 */
export function databaseCutoff(now = Date.now()): string | null {
  return archiveEnabled() ? new Date(now - (databaseDays() + 1) * DAY).toISOString() : null;
}

async function readAll(keys: string[]): Promise<AuditLog[]> {
  const out: AuditLog[] = [];
  for (let i = 0; i < keys.length; i += PARALLEL_READS) {
    const bodies = await Promise.all(keys.slice(i, i + PARALLEL_READS).map((k) => store().get(k)));
    for (const b of bodies) {
      if (!b) continue;
      try { out.push(JSON.parse(b.toString('utf8')) as AuditLog); } catch { /* a damaged copy is skipped, not fatal */ }
    }
  }
  return out;
}

/** Archived records for a company between two ISO timestamps, newest first, up to `maxItems`. */
export async function readArchive(
  tenantId: string, from: string, to: string, maxItems: number,
): Promise<{ logs: AuditLog[]; truncated: boolean }> {
  const logs: AuditLog[] = [];
  const firstDay = day(Date.parse(from));
  // A record is filed under the day it was written, a moment after its timestamp, so look one day past `to`.
  for (let t = Date.parse(to) + DAY; day(t) >= firstDay; t -= DAY) {
    const found = (await readAll(await store().list(`logs/${tenantId}/${day(t)}/`)))
      .filter((l) => l.tenantId === tenantId && l.timestamp >= from && l.timestamp <= to)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    logs.push(...found);
    if (logs.length > maxItems) break;
  }
  // A record written just after midnight sits in the next day's folder, so sort across folders once more.
  logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return { logs: logs.slice(0, maxItems), truncated: logs.length > maxItems };
}

/**
 * One archived record by request ID, searching day folders from the end of the database window back to the
 * company's retention. Pass `around` (the record's time, when the caller knows it) to look in one place only.
 */
export async function findArchived(
  tenantId: string, requestId: string, retentionDays: number, around?: string, now = Date.now(),
): Promise<AuditLog | null> {
  if (!archiveEnabled() || !requestId || requestId.includes('/')) return null;
  const at = around ? Date.parse(around) : NaN;
  const days = Number.isFinite(at)
    ? [at, at + DAY]
    : Array.from({ length: Math.max(0, retentionDays - databaseDays() + 2) }, (_, i) => now - (databaseDays() - 1 + i) * DAY);
  for (const t of days) {
    const keys = await store().list(`logs/${tenantId}/${day(t)}/${requestId}-`);
    const [log] = await readAll(keys.slice(0, 1));
    if (log && log.tenantId === tenantId && log.requestId === requestId) return log;
  }
  return null;
}
