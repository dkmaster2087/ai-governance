import { collection } from '@ai-governance/storage';
import { FastifyInstance } from 'fastify';
import { createLogger } from '@ai-governance/utils';
import { computeLicenseStatus, LicenseKey, LicenseStatus } from '../services/license-state';
import { LicenseClaims, LicenseFileError, normalizeAddress, verifyLicenseFile } from './license-file';

const logger = createLogger('gateway:offline-license');

/**
 * Licensing for a customer-run install (LICENSING=offline). The whole install has one license: a signed file
 * the customer enters on the License page (or sets in PROBALINE_LICENSE when installing). It is checked here,
 * locally; nothing is sent to us. The timeline is Cloud's: notices 30 days before the end, 30 days of grace
 * after it, then AI requests are refused. An install that never had a license gets the same 30 days from its
 * first start.
 */

export const offlineLicensing = () => (process.env.LICENSING ?? '').toLowerCase() === 'offline';

/** Where the install keeps its license: the shared database, so every copy of the gateway agrees. */
const INSTALL = '_install';
const store = () => collection<{ tenantId: string; period: string; licenseFile?: string; at?: string; by?: string }>('metrics');

export interface InstalledLicense { claims: LicenseClaims; installedAt?: string; source: 'dashboard' | 'environment' }

export class OfflineLicenseState {
  private cache: { license: InstalledLicense | null; since: string; until: number } | null = null;
  constructor(private ttlMs = 60_000) {}

  /** The license in force: the valid one (stored or from the environment) that ends last. */
  private async load(): Promise<{ license: InstalledLicense | null; since: string }> {
    if (this.cache && this.cache.until > Date.now()) return this.cache;
    const found: InstalledLicense[] = [];
    try {
      const stored = await store().get({ tenantId: INSTALL, period: 'license#current' });
      if (stored?.licenseFile) found.push({ claims: verifyLicenseFile(stored.licenseFile), installedAt: stored.at, source: 'dashboard' });
    } catch (err) {
      logger.warn('Stored license unreadable', { error: (err as Error).message });
    }
    if (process.env.PROBALINE_LICENSE) {
      try { found.push({ claims: verifyLicenseFile(process.env.PROBALINE_LICENSE), source: 'environment' }); }
      catch (err) { logger.error('PROBALINE_LICENSE is not a valid license file', { error: (err as Error).message }); }
    }
    const license = found.sort((a, b) => Date.parse(b.claims.endsAt) - Date.parse(a.claims.endsAt))[0] ?? null;
    const since = await this.firstStart();
    this.cache = { license, since, until: Date.now() + this.ttlMs };
    return this.cache;
  }

  /** When this install first started: an install without a license gets its grace period from then. */
  private async firstStart(): Promise<string> {
    try {
      const row = await store().get({ tenantId: INSTALL, period: 'license#since' });
      if (row?.at) return row.at;
      const at = new Date().toISOString();
      await store().put({ tenantId: INSTALL, period: 'license#since', at });
      return at;
    } catch {
      return new Date().toISOString();
    }
  }

  /** The same for every company on the install. Null only if nothing can be read (traffic is never stopped then). */
  async get(_tenantId?: string): Promise<LicenseStatus | null> {
    try {
      const { license, since } = await this.load();
      const keys: LicenseKey[] = license ? [{
        tenantId: license.claims.tenantId, keyId: license.claims.id, keyHash: '', keyPrefix: '', name: 'License', scopes: [], status: 'active',
        rateLimit: 0, createdAt: license.claims.issuedAt, expiresAt: license.claims.endsAt, activation: 'active',
        license: { plan: license.claims.plan, type: 'onprem', maxUsers: license.claims.maxUsers },
      } as unknown as LicenseKey] : [];
      return computeLicenseStatus(keys, since);
    } catch (err) {
      logger.warn('License state unavailable', { error: (err as Error).message });
      return null;
    }
  }

  async current(): Promise<InstalledLicense | null> {
    return (await this.load()).license;
  }

  /** The hostnames the license lets this gateway serve, or null while no license is installed. */
  async addresses(): Promise<string[] | null> {
    const l = await this.current().catch(() => null);
    return l ? l.claims.addresses : null;
  }

  /** A company admin enters a license file. It must be ours and still valid; it replaces the stored one. */
  async install(text: string, by: string): Promise<InstalledLicense> {
    const claims = verifyLicenseFile(text);
    if (Date.parse(claims.endsAt) <= Date.now()) throw new LicenseFileError('That license has already ended. Ask Probaline for a renewal.', 'MALFORMED');
    const at = new Date().toISOString();
    await store().put({ tenantId: INSTALL, period: 'license#current', licenseFile: text.trim(), at, by });
    this.invalidate();
    logger.info('License installed', { licenseId: claims.id, endsAt: claims.endsAt, by });
    return { claims, installedAt: at, source: 'dashboard' };
  }

  invalidate(_tenantId?: string) { this.cache = null; }
}

let shared: OfflineLicenseState | null = null;
export const offlineLicense = () => (shared ??= new OfflineLicenseState());
export const setOfflineLicense = (s: OfflineLicenseState | null) => { shared = s; };

/** Whether a request's Host is one the license names. Ports and case don't matter. */
export const addressAllowed = (host: string | undefined, addresses: string[]) => !!host && addresses.includes(normalizeAddress(host));

/**
 * One license, one gateway: refuse requests made to any address the license doesn't name. Health checks and the
 * License page answer on any address, so an install reached the wrong way can still be fixed. Before a license
 * is entered, every address works (the install's first 30 days).
 */
export function licensedAddressOnly(app: FastifyInstance, license: () => OfflineLicenseState = offlineLicense) {
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (path.startsWith('/health') || path.startsWith('/v1/license') || path === '/v1/me') return;
    const addresses = await license().addresses();
    if (!addresses || addressAllowed(request.hostname, addresses)) return;
    return reply.status(421).send({
      error: `This Probaline license is for ${addresses.join(' or ')}. Use that address, or ask Probaline for a license for this one.`,
      code: 'WRONG_ADDRESS_FOR_LICENSE',
    });
  });
}
