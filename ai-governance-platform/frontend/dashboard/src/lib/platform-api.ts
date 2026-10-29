import { createApiClient } from './http';

const api = createApiClient('/api');

export type Plan = 'starter' | 'professional' | 'enterprise';

export interface Tenant {
  tenantId: string;
  name: string;
  adminEmail: string;
  plan: Plan;
  status: 'active' | 'suspended' | 'trial';
  deploymentMode: 'saas' | 'onprem';
  region: string;
  createdAt: string;
  settings?: { auditLogRetentionDays?: number; governanceFailMode?: 'open' | 'closed' };
}

export interface TenantInput {
  name: string;
  adminEmail: string;
  plan: Plan;
  deploymentMode: 'saas' | 'onprem';
  region: string;
  auditLogRetentionDays: number;
}

export interface TenantUsage {
  tenantId: string;
  requests: number;
  stopped: number;
  cleaned: number;
  cost: number;
  lastRequestAt: string | null;
  truncated: boolean;
  models: Array<{ model: string; requests: number; cost: number }>;
}

export interface PlatformUsage {
  from: string;
  to: string;
  totals: { requests: number; stopped: number; cleaned: number; cost: number };
  days: Array<{ date: string; requests: number; stopped: number }>;
  tenants: TenantUsage[];
  truncated: boolean;
}

export type Days = 7 | 30 | 90;

/** For a platform admin acting on one tenant. */
const as = (tenantId: string) => ({ headers: { 'x-tenant-id': tenantId } });

export const listTenants = async (): Promise<Tenant[]> => {
  const { data } = await api.get('/v1/tenants');
  return Array.isArray(data) ? data : [];
};
export const getTenant = async (tenantId: string): Promise<Tenant> =>
  (await api.get(`/v1/tenants/${encodeURIComponent(tenantId)}`, as(tenantId))).data;
export const createTenant = async (input: TenantInput): Promise<Tenant> => (await api.post('/v1/tenants', input)).data;
export const updateTenant = async (tenantId: string, input: Partial<TenantInput>) =>
  (await api.put(`/v1/tenants/${encodeURIComponent(tenantId)}`, input)).data;
export const suspendTenant = async (tenantId: string) => (await api.post(`/v1/tenants/${encodeURIComponent(tenantId)}/suspend`, {})).data;
export const activateTenant = async (tenantId: string) => (await api.post(`/v1/tenants/${encodeURIComponent(tenantId)}/activate`, {})).data;

export const fetchPlatformUsage = async (days: Days, tenantId?: string): Promise<PlatformUsage> =>
  (await api.get('/v1/platform/usage', { params: { days, tenantId, tz: new Date().getTimezoneOffset() } })).data;

/** What a tenant has set up, read as that tenant. Each part is null when it couldn't be read. */
export async function fetchTenantSetup(tenantId: string) {
  const safe = async <T>(fn: () => Promise<T>): Promise<T | null> => { try { return await fn(); } catch { return null; } };
  const [models, rules, frameworks] = await Promise.all([
    safe(async () => (await api.get('/v1/models/config', as(tenantId))).data as Array<{ name: string; status: string }>),
    safe(async () => (await api.get('/v1/rules', as(tenantId))).data as { rules: Array<{ enabled: boolean; policyEnabled?: boolean }>; failMode: 'open' | 'closed' }),
    safe(async () => (await api.get(`/v1/compliance/status/${encodeURIComponent(tenantId)}`, as(tenantId))).data as Array<{ name: string; status: string }>),
  ]);
  const ruleList = rules?.rules ?? null;
  return {
    failMode: rules?.failMode ?? null,
    modelsListed: models ? models.filter((m) => m.status === 'active').length : null,
    rulesOn: ruleList ? ruleList.filter((r) => r.enabled && r.policyEnabled !== false).length : null,
    frameworksOn: frameworks ? frameworks.filter((f) => f.status !== 'disabled').map((f) => f.name.replace(/\s*\(.*\)\s*$/, '')) : null,
  };
}

export interface ServiceCheck { name: string; status: 'healthy' | 'unhealthy'; latencyMs?: number; error?: string }
export interface Health { status: 'healthy' | 'degraded' | 'unhealthy'; version: string; uptime: number; dependencies: ServiceCheck[] }

/** The gateway's own check of everything on the request path. */
export const fetchHealth = async (): Promise<Health> => (await api.get('/health/deep', { timeout: 8000 })).data;

export const money = (n: number) =>
  n === 0 ? '$0' : n < 0.01 ? 'under $0.01' : n >= 100 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;

export const ago = (iso: string | null) => {
  if (!iso) return 'Never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
};
