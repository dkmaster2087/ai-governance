import { allPages, collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { randomBytes, createHash } from 'crypto';

const logger = createLogger('gateway:api-keys');

export interface ApiKey {
  tenantId: string;
  keyId: string;
  keyHash: string;        // SHA-256 hash of the full key (we never store the raw key)
  keyPrefix: string;      // First 8 chars for display (e.g., "pbl_dk...")
  name: string;           // Human-readable label
  scopes: string[];       // e.g., ['chat', 'models', 'audit']
  status: 'active' | 'revoked' | 'expired';
  rateLimit: number;      // Requests per minute for this key
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  createdBy: string;
  /** Present on Cloud license keys (scope 'reporting:ingest', a name kept from the retired reporting agent). */
  license?: LicenseInfo;
}

export interface LicenseInfo {
  plan: string;
  type: 'cloud' | 'onprem';
  /** No longer used: licenses don't limit users. Kept so older records still read. */
  maxUsers?: number;
  /** What the on-prem agent is allowed to report back. */
  /** From the retired reporting agent; ignored, kept so older records still read. */
  reportingConfig?: { usageMetrics: boolean; costData: boolean; complianceStatus: boolean; auditLogs: boolean };
}

/** Generate a secure API key: pbl_<tenantShort>_<random32hex> */
export function generateApiKey(tenantId: string): { raw: string; hash: string; prefix: string; keyId: string } {
  const tenantShort = tenantId.replace('tenant_', '').slice(0, 6);
  const random = randomBytes(24).toString('hex');
  const raw = `pbl_${tenantShort}_${random}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 16) + '...';
  const keyId = `key_${randomBytes(8).toString('hex')}`;
  return { raw, hash, prefix, keyId };
}

/** Hash a raw API key for lookup */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export class ApiKeyRepository {
  private keys = () => collection<ApiKey>('apiKeys');

  /** Create a new API key record */
  async create(key: ApiKey): Promise<void> {
    await this.keys().put(key);
    logger.info('API key created', { tenantId: key.tenantId, keyId: key.keyId, name: key.name });
  }

  /** Get all keys for a tenant */
  async getForTenant(tenantId: string): Promise<ApiKey[]> {
    try {
      return await allPages((after) => this.keys().query({ partition: tenantId, after }));
    } catch (err) {
      logger.warn('API keys not available', { tenantId, error: (err as Error).message });
      return [];
    }
  }

  /** Find a key by its hash (for auth validation) */
  async findByHash(keyHash: string): Promise<ApiKey | null> {
    const page = await this.keys().query({ partition: keyHash, index: 'keyHash-index', limit: 1 });
    return page.items[0] ?? null;
  }

  /** Revoke a key. Does nothing if the key no longer exists. */
  async revoke(tenantId: string, keyId: string): Promise<void> {
    await this.keys().update({ tenantId, keyId }, { set: { status: 'revoked' }, ifExists: true });
    logger.info('API key revoked', { tenantId, keyId });
  }

  /** Replace the license details on a license key. Throws if the key doesn't exist. */
  async setLicenseInfo(tenantId: string, keyId: string, license: LicenseInfo): Promise<void> {
    const updated = await this.keys().update({ tenantId, keyId }, { set: { license }, ifExists: true });
    if (!updated) throw Object.assign(new Error('License key not found'), { statusCode: 404, code: 'NOT_FOUND' });
  }

  /** Update last used timestamp */
  async touchLastUsed(tenantId: string, keyId: string): Promise<void> {
    try {
      await this.keys().update({ tenantId, keyId }, { set: { lastUsedAt: new Date().toISOString() }, ifExists: true });
    } catch { /* non-critical */ }
  }

  /** Delete a key permanently */
  async delete(tenantId: string, keyId: string): Promise<void> {
    await this.keys().delete({ tenantId, keyId });
    logger.info('API key deleted', { tenantId, keyId });
  }
}
