import { collection } from '@ai-governance/storage';
import { TenantSettings } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { getSecurityConfig } from '../config/security';
import type { SecretsAction } from './secret-detector';
import type { PromptAttackAction } from './prompt-attack';

const logger = createLogger('gateway:tenant-settings');

export type FailMode = 'open' | 'closed';

/** Loads tenant settings on the request path, with a short cache. */
export class TenantSettingsService {
  private cache = new Map<string, { settings: Partial<TenantSettings> | null; status: string | null; until: number }>();

  constructor(private cacheTtlMs = 60_000, private defaultFailMode: FailMode = getSecurityConfig().governanceFailMode) {}

  private async load(tenantId: string): Promise<{ settings: Partial<TenantSettings> | null; status: string | null }> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.until > Date.now()) return cached;
    try {
      const tenant = await collection('tenants').get({ tenantId });
      const entry = {
        settings: (tenant?.settings as Partial<TenantSettings> | undefined) ?? null,
        status: (tenant?.status as string | undefined) ?? null,
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

  /** Drop the cached copy so the next request sees changes (suspension, settings) immediately. */
  invalidate(tenantId: string) {
    this.cache.delete(tenantId);
  }

  /** Fail mode for this tenant; falls back to the deployment default (closed unless configured). */
  async getFailMode(tenantId: string): Promise<FailMode> {
    const settings = await this.getSettings(tenantId);
    const mode = settings?.governanceFailMode;
    return mode === 'open' || mode === 'closed' ? mode : this.defaultFailMode;
  }

  /** What to do with credentials found in prompts; blocking unless the tenant chose otherwise. */
  async getSecretsAction(tenantId: string): Promise<SecretsAction> {
    const action = (await this.getSettings(tenantId))?.secretsAction;
    return action === 'redact' || action === 'off' ? action : 'block';
  }

  /** Whether to look for prompt attacks (Beta); off unless the tenant turned it on. */
  async getPromptAttackAction(tenantId: string): Promise<PromptAttackAction> {
    const action = (await this.getSettings(tenantId))?.promptAttackAction;
    return action === 'flag' || action === 'block' ? action : 'off';
  }
}

/** Shared instance so every part of the gateway sees the same cache (and invalidations). */
let shared: TenantSettingsService | null = null;
export function tenantSettings(): TenantSettingsService {
  if (!shared) shared = new TenantSettingsService();
  return shared;
}
