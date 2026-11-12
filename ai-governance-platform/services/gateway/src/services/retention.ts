import { allPages, collection, objects } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { tenantSettings } from './tenant-settings.service';

const logger = createLogger('gateway:retention');

/**
 * How long each company's evidence is kept, and the deleting that makes "kept until" true.
 *
 * - The archive copy (one folder per day) is kept for the company's full retention period and removed by a
 *   daily sweep, claimed by one gateway instance.
 * - The searchable database record is kept for the recent window only (AUDIT_DB_DAYS, 90 by default) so the
 *   database stays small and fast; older records are read from the archive, more slowly. Without an archive
 *   (OBJECT_STORE=none) the database is the only copy and keeps the full retention period.
 * - A legal hold stops both: records lose their expiry, and the sweep skips the company.
 */

export const DEFAULT_RETENTION_DAYS = 365;
const DAY_MS = 86_400_000;
/** Extra days a record stays in the database past the window, so reads at the window's edge never need the archive. */
const DATABASE_MARGIN_DAYS = 2;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const archiveBucket = () => process.env.AUDIT_LOG_BUCKET || 'ai-governance-audit-logs';

export interface Retention { days: number; hold: boolean }

/** Days a record stays searchable in the database. */
export function databaseDays(): number {
  const d = Number(process.env.AUDIT_DB_DAYS);
  return d > 0 ? d : 90;
}

/** Whether an archive copy exists to fall back on (any object store but `none`). */
export const archiveEnabled = () => (process.env.OBJECT_STORE || 's3').toLowerCase() !== 'none';

export async function retentionOf(tenantId: string): Promise<Retention> {
  const s = await tenantSettings().getSettings(tenantId);
  const days = Number(s?.auditLogRetentionDays);
  return { days: days > 0 ? days : DEFAULT_RETENTION_DAYS, hold: s?.legalHold?.on === true };
}

/**
 * When the database record expires, in seconds, or undefined while on hold. Never later than the company's
 * retention; with an archive, no later than the database window either.
 */
export function expiryOf(timestamp: string, r: Retention): number | undefined {
  if (r.hold) return undefined;
  const days = archiveEnabled() ? Math.min(r.days, databaseDays() + DATABASE_MARGIN_DAYS) : r.days;
  return Math.floor((Date.parse(timestamp) + days * DAY_MS) / 1000);
}

type AuditRow = { tenantId: string; requestId: string; timestamp: string; ttl?: number };

/**
 * Re-date every record a company has, after its retention period or legal hold changed. Records already past
 * a shorter period get an expiry in the past and are deleted by the database shortly after.
 */
export async function reapplyRetention(tenantId: string): Promise<{ records: number }> {
  tenantSettings().invalidate(tenantId);
  const r = await retentionOf(tenantId);
  const rows = (await allPages((after) => collection<AuditRow>('auditLogs').query({ partition: tenantId, after }))) as AuditRow[];
  for (const row of rows) {
    const ttl = expiryOf(row.timestamp, r);
    if (ttl === row.ttl) continue;
    await collection<AuditRow>('auditLogs').update({ tenantId, requestId: row.requestId }, ttl === undefined ? { remove: ['ttl'], ifExists: true } : { set: { ttl }, ifExists: true });
  }
  logger.info('Retention applied to existing records', { tenantId, records: rows.length, days: r.days, hold: r.hold });
  return { records: rows.length };
}

type TenantRow = { tenantId: string; createdAt?: string; archiveSweptThrough?: string };

/** Remove the company's archive folders for days now past its retention. Returns the days removed. */
export async function sweepArchive(tenant: TenantRow, now = Date.now()): Promise<number> {
  const r = await retentionOf(tenant.tenantId);
  if (r.hold) return 0;
  const lastToGo = day(now - (r.days + 1) * DAY_MS);
  // Start after the last day already swept, or from when the company was created.
  const fromMs = tenant.archiveSweptThrough
    ? Date.parse(tenant.archiveSweptThrough) + DAY_MS
    : Date.parse(tenant.createdAt ?? lastToGo) - DAY_MS;
  let removed = 0;
  let through: string | undefined;
  for (let t = fromMs, n = 0; day(t) <= lastToGo && n < 4000; t += DAY_MS, n++) {
    removed += await objects(archiveBucket(), { kms: true }).deletePrefix(`logs/${tenant.tenantId}/${day(t)}/`);
    through = day(t);
  }
  if (through) await collection('tenants').update({ tenantId: tenant.tenantId }, { set: { archiveSweptThrough: through }, ifExists: true });
  if (removed) logger.info('Archive copies past retention removed', { tenantId: tenant.tenantId, objects: removed, through });
  return removed;
}

/** Once a day, across every gateway instance: the first to claim the day sweeps every company. */
export async function dailySweep(now = Date.now()): Promise<boolean> {
  const claimed = await collection('metrics').put(
    { tenantId: 'platform', period: `retention-sweep#${day(now)}`, ttl: Math.floor(now / 1000) + 3 * 86_400 },
    { ifNotExists: true },
  );
  if (!claimed) return false;
  const tenants = (await allPages((after) => collection<TenantRow>('tenants').scan({ after, limit: 1000 }))) as TenantRow[];
  for (const t of tenants) {
    try { await sweepArchive(t, now); } catch (err) {
      logger.error('Archive sweep failed for a company', { tenantId: t.tenantId, error: (err as Error).message });
    }
  }
  return true;
}

/** Check hourly; the sweep itself runs once a day. */
export function scheduleRetention(): NodeJS.Timeout {
  const run = () => dailySweep().catch((err) => logger.error('Retention sweep failed', { error: (err as Error).message }));
  setTimeout(run, 60_000).unref();
  const timer = setInterval(run, 3600_000);
  timer.unref();
  return timer;
}
