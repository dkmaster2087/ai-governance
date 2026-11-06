import { collection } from '@ai-governance/storage';

/** What reports need from a company's settings. Read-only: the gateway owns these settings. */

export interface ShadowAiPolicy {
  mode: 'monitor' | 'block';
  decisions: Record<string, 'blocked' | 'allowed'>;
}

export interface TenantView {
  exists: boolean;
  secretsActive: boolean;
  /** How long case files are kept, for the "kept until" line on each. */
  retentionDays: number;
  shadowAi: ShadowAiPolicy;
}

const DEFAULT_RETENTION_DAYS = 365;

export async function tenantView(tenantId: string): Promise<TenantView> {
  const t = await collection('tenants').get({ tenantId });
  const settings = (t?.settings ?? {}) as { secretsAction?: string; auditLogRetentionDays?: number };
  const shadow = (t?.shadowAi ?? {}) as Partial<ShadowAiPolicy>;
  return {
    exists: !!t,
    secretsActive: settings.secretsAction !== 'off',
    retentionDays: Number(settings.auditLogRetentionDays) > 0 ? Number(settings.auditLogRetentionDays) : DEFAULT_RETENTION_DAYS,
    shadowAi: { mode: shadow.mode === 'block' ? 'block' : 'monitor', decisions: { ...(shadow.decisions ?? {}) } },
  };
}
