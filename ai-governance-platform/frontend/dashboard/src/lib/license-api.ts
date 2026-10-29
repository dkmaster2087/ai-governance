import { createApiClient } from './http';

const gateway = createApiClient('/api');

export interface ReportingConfig { usageMetrics: boolean; costData: boolean; complianceStatus: boolean; auditLogs: boolean }

/** A license as the gateway returns it (the key itself is only returned once, when issued). */
export interface License {
  licenseId: string;
  keyPrefix: string;
  tenantId: string;
  tenantName: string;
  status: 'active' | 'expired' | 'revoked';
  issuedAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  plan: string;
  type: 'cloud' | 'onprem';
  maxUsers: number;
  reportingConfig: ReportingConfig;
}

export const REPORTING_LABELS: Record<keyof ReportingConfig, string> = {
  usageMetrics: 'Usage numbers',
  costData: 'Spend',
  complianceStatus: 'Compliance status',
  auditLogs: 'Audit records',
};

export const fetchAllLicenses = async () => (await gateway.get<License[]>('/v1/licenses')).data;
export const fetchMyLicense = async (): Promise<License | null> => {
  try {
    return (await gateway.get<License>('/v1/license')).data;
  } catch (err) {
    if ((err as { response?: { status?: number } }).response?.status === 404) return null;
    throw err;
  }
};
export const fetchTenantLicenses = async (tenantId: string) =>
  (await gateway.get<License[]>(`/v1/tenants/${encodeURIComponent(tenantId)}/licenses`, { headers: { 'x-tenant-id': tenantId } })).data;
export const issueLicense = async (tenantId: string, input: { plan: string; type: 'cloud' | 'onprem'; maxUsers: number; validityDays: number }) =>
  (await gateway.post<License & { licenseKey: string }>(`/v1/tenants/${encodeURIComponent(tenantId)}/licenses`, input)).data;
export const revokeLicense = async (tenantId: string, licenseId: string) =>
  (await gateway.post(`/v1/tenants/${encodeURIComponent(tenantId)}/licenses/${encodeURIComponent(licenseId)}/revoke`)).data;
export const setReporting = async (config: ReportingConfig) => (await gateway.put('/v1/license/reporting', config)).data;

export const formatDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
