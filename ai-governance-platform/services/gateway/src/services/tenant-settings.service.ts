import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { TenantSettings } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { getSecurityConfig } from '../config/security';

const logger = createLogger('gateway:tenant-settings');

export type FailMode = 'open' | 'closed';

/** Loads tenant settings on the request path, with a short cache. */
export class TenantSettingsService {
  private cache = new Map<string, { settings: Partial<TenantSettings> | null; status: string | null; until: number }>();
  private client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
  private table = process.env.TENANTS_TABLE || 'ai-gov-tenants-dev';

  constructor(private cacheTtlMs = 60_000, private defaultFailMode: FailMode = getSecurityConfig().governanceFailMode) {}

  private async load(tenantId: string): Promise<{ settings: Partial<TenantSettings> | null; status: string | null }> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.until > Date.now()) return cached;
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.table, Key: { tenantId } }));
      const entry = {
        settings: (result.Item?.settings as Partial<TenantSettings> | undefined) ?? null,
        status: (result.Item?.status as string | undefined) ?? null,
        until: Date.now() + this.cacheTtlMs,
      };
      this.cache.set(tenantId, entry);
      return entry;
    } catch (err) {
      logger.warn('Could not load tenant settings, using defaults', { tenantId, error: (err as Error).message });
      return cached ?? { settings: null, status: null };
    }
  }

  async getSettings(tenantId: string): Promise<Partial<TenantSettings> | null> {
    return (await this.load(tenantId)).settings;
  }

  /** The tenant's status ('active', 'suspended', ...), or null if the tenant record isn't found. */
  async getStatus(tenantId: string): Promise<string | null> {
    return (await this.load(tenantId)).status;
  }

  /** Fail mode for this tenant; falls back to the deployment default (closed unless configured). */
  async getFailMode(tenantId: string): Promise<FailMode> {
    const settings = await this.getSettings(tenantId);
    const mode = settings?.governanceFailMode;
    return mode === 'open' || mode === 'closed' ? mode : this.defaultFailMode;
  }
}
