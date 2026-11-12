import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { ApiKey } from '../repositories/api-key.repository';

const logger = createLogger('gateway:license');

/**
 * Where a company stands with its license, and what that means for the service.
 *
 *   active    a license is valid, more than the warning period away from its end
 *   expiring  a license is valid, but ends within the warning period: everyone is told
 * A license counts once the company has entered its key on the License page (activated). Licenses issued
 * before activation existed count as activated. A company admin can remove a license; it then counts as ended.
 *
 *   grace     no valid license (it expired, was revoked or removed, or none was ever entered): everything still works
 *             until the grace period is over, and everyone is told how long is left
 *   lapsed    the grace period is over: AI traffic is refused; people can still sign in, renew and read evidence
 *
 * The grace period runs from the day the last license ended (or, when revoked, the date the operator chose).
 * A company that never had a license gets the grace period from when it was created, or, for companies that
 * existed before licensing was enforced, from the first time this check saw them.
 */

export type LicenseState = 'active' | 'expiring' | 'grace' | 'lapsed';

export interface LicenseStatus {
  state: LicenseState;
  /** Why there is no valid license, when there isn't. */
  reason?: 'expired' | 'revoked' | 'removed' | 'none';
  plan?: string;
  /** When the valid license ends (active, expiring). */
  endsAt?: string;
  /** When the last license ended (grace, lapsed). */
  endedAt?: string;
  /** When AI traffic stops (grace), or stopped (lapsed). */
  graceUntil?: string;
  /** Whole days until endsAt (expiring) or graceUntil (grace). */
  daysLeft?: number;
}

export const GRACE_DAYS = () => Number(process.env.LICENSE_GRACE_DAYS) || 30;
export const WARN_DAYS = () => Number(process.env.LICENSE_WARN_DAYS) || 30;
const DAY = 86_400_000;
/** The platform operator's own tenant never needs a license. */
const EXEMPT = new Set(['tenant_platform']);

const daysUntil = (iso: string, now: number) => Math.max(0, Math.ceil((Date.parse(iso) - now) / DAY));
const plus = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY).toISOString();

export type LicenseKey = ApiKey & {
  revokedAt?: string;
  graceUntil?: string;
  /** pending: issued, waiting for the company to enter the key. Missing means activated (older licenses). */
  activation?: 'pending' | 'active' | 'removed';
  activatedAt?: string;
  removedAt?: string;
};

const ended = (k: LicenseKey, now: number): { at: string; reason: 'expired' | 'revoked' | 'removed' } | null => {
  if (k.status === 'revoked') return { at: k.revokedAt ?? k.createdAt, reason: 'revoked' };
  if (k.activation === 'removed') return { at: k.removedAt ?? k.createdAt, reason: 'removed' };
  if (k.expiresAt && Date.parse(k.expiresAt) <= now) return { at: k.expiresAt, reason: 'expired' };
  return null;
};

/** The state, from a company's license keys (and, without any, when its grace period started). */
export function computeLicenseStatus(keys: LicenseKey[], noLicenseSince: string, now = Date.now()): LicenseStatus {
  const counted = keys.filter((k) => k.activation !== 'pending');
  const valid = counted
    .filter((k) => k.status !== 'revoked' && k.activation !== 'removed' && (!k.expiresAt || Date.parse(k.expiresAt) > now))
    .sort((a, b) => (Date.parse(b.expiresAt ?? '9999-12-31') - Date.parse(a.expiresAt ?? '9999-12-31')));
  if (valid.length) {
    const best = valid[0];
    if (!best.expiresAt) return { state: 'active', plan: best.license?.plan };
    const daysLeft = daysUntil(best.expiresAt, now);
    return { state: daysLeft <= WARN_DAYS() ? 'expiring' : 'active', plan: best.license?.plan, endsAt: best.expiresAt, ...(daysLeft <= WARN_DAYS() ? { daysLeft } : {}) };
  }

  let reason: LicenseStatus['reason'] = 'none';
  let endedAt = noLicenseSince;
  let graceUntil = plus(noLicenseSince, GRACE_DAYS());
  let plan: string | undefined;
  // The license that ended last decides the grace period.
  for (const k of counted) {
    const e = ended(k, now);
    if (!e) continue;
    const until = e.reason === 'revoked' && k.graceUntil ? k.graceUntil : plus(e.at, GRACE_DAYS());
    if (reason === 'none' || until > graceUntil) {
      reason = e.reason;
      endedAt = e.at;
      graceUntil = until;
      plan = k.license?.plan;
    }
  }
  const lapsed = Date.parse(graceUntil) <= now;
  return { state: lapsed ? 'lapsed' : 'grace', reason, endedAt, graceUntil, ...(plan ? { plan } : {}), ...(lapsed ? {} : { daysLeft: daysUntil(graceUntil, now) }) };
}

/** Each company's state, cached for a minute (it's checked on every AI request). */
export class LicenseStateService {
  private cache = new Map<string, { status: LicenseStatus; until: number }>();
  constructor(private ttlMs = 60_000) {}

  async get(tenantId: string): Promise<LicenseStatus | null> {
    if (EXEMPT.has(tenantId)) return null;
    const hit = this.cache.get(tenantId);
    if (hit && hit.until > Date.now()) return hit.status;
    try {
      const [tenant, keys] = await Promise.all([
        collection('tenants').get({ tenantId }),
        collection<LicenseKey>('apiKeys').query({ partition: tenantId, limit: 1000 }).then((p) => p.items.filter((k) => k.scopes?.includes('reporting:ingest'))),
      ]);
      if (!tenant) return null;
      // Licenses revoked before grace periods existed have no date: their grace starts now, once.
      for (const k of keys) {
        if (k.status === 'revoked' && !k.revokedAt) {
          k.revokedAt = new Date().toISOString();
          k.graceUntil = plus(k.revokedAt, GRACE_DAYS());
          await collection('apiKeys').update({ tenantId, keyId: k.keyId }, { set: { revokedAt: k.revokedAt, graceUntil: k.graceUntil }, ifExists: true });
        }
      }
      let since = tenant.licenseGraceStartedAt as string | undefined;
      if (!keys.some((k) => k.activation !== 'pending') && !since) {
        // First time without a license: start counting now, or from creation for companies made since.
        const created = Date.parse(String(tenant.createdAt ?? ''));
        // Newer companies count from creation (a trial); older ones from now, so nobody is cut off at once.
        since = created && created > Date.now() - GRACE_DAYS() * DAY ? new Date(created).toISOString() : new Date().toISOString();
        await collection('tenants').update({ tenantId }, { set: { licenseGraceStartedAt: since }, ifExists: true });
      }
      const status = computeLicenseStatus(keys, since ?? new Date().toISOString());
      this.cache.set(tenantId, { status, until: Date.now() + this.ttlMs });
      return status;
    } catch (err) {
      // Never stop a company's traffic because the license couldn't be read.
      logger.warn('License state unavailable', { tenantId, error: (err as Error).message });
      return hit?.status ?? null;
    }
  }

  invalidate(tenantId: string) { this.cache.delete(tenantId); }
}

let shared: LicenseStateService | null = null;
/**
 * The license state the gateway enforces. Cloud: licenses we issued, per company. A customer-run install
 * (LICENSING=offline): its one signed license file, checked locally (licensing/offline-license.ts).
 */
export const licenseState = (): Pick<LicenseStateService, 'get' | 'invalidate'> => {
  if ((process.env.LICENSING ?? '').toLowerCase() === 'offline') {
    // Loaded here, not at the top: that module builds on this one.
    return (require('../licensing/offline-license') as typeof import('../licensing/offline-license')).offlineLicense();
  }
  return (shared ??= new LicenseStateService());
};
export const setLicenseState = (s: LicenseStateService | null) => { shared = s; };
