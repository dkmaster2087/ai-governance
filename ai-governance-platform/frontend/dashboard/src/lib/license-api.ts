import { createApiClient } from './http';

const gateway = createApiClient('/api');

export interface ReportingConfig { usageMetrics: boolean; costData: boolean; complianceStatus: boolean; auditLogs: boolean }

/** A license as the gateway returns it (the key itself is only returned once, when issued). */
export interface License {
  licenseId: string;
  keyPrefix: string;
  tenantId: string;
  tenantName: string;
  /** pending: issued, waiting for the company to enter the key. */
  status: 'pending' | 'active' | 'expired' | 'revoked' | 'removed';
  issuedAt: string;
  expiresAt?: string;
  activatedAt?: string;
  revokedAt?: string;
  removedAt?: string;
  graceUntil?: string;
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

/** Where a company stands. grace: no valid license, but everything works until graceUntil. lapsed: AI requests stopped. */
export interface LicenseStatus {
  state: 'active' | 'expiring' | 'grace' | 'lapsed';
  reason?: 'expired' | 'revoked' | 'removed' | 'none';
  plan?: string;
  endsAt?: string;
  endedAt?: string;
  graceUntil?: string;
  daysLeft?: number;
}

export const fetchLicenseStatus = async () => (await gateway.get<LicenseStatus>('/v1/license/status')).data;
export const fetchLicenseOverview = async () => (await gateway.get<{ status: LicenseStatus; licenses: License[] }>('/v1/license/overview')).data;
export const activateLicense = async (licenseKey: string) => (await gateway.post<{ license: License; status: LicenseStatus }>('/v1/license/activate', { licenseKey })).data;
export const removeLicense = async (licenseId: string) => (await gateway.post(`/v1/license/${encodeURIComponent(licenseId)}/remove`, {})).data;

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
export const revokeLicense = async (tenantId: string, licenseId: string, graceDays?: number) =>
  (await gateway.post(`/v1/tenants/${encodeURIComponent(tenantId)}/licenses/${encodeURIComponent(licenseId)}/revoke`, graceDays === undefined ? {} : { graceDays })).data;

/** Plain words for a license's status. */
export const STATUS_LABEL: Record<License['status'], string> = { pending: 'Waiting for the key', active: 'Active', expired: 'Expired', revoked: 'Revoked', removed: 'Removed' };

/** What a company sees: whatever the reason, an ended license is "expired" to them. */
export function statusMessage(s: LicenseStatus, canEnterKey: boolean): { tone: 'warn' | 'stop'; title: string; detail: string } | null {
  const date = (iso?: string) => formatDate(iso);
  const days = (n?: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  const action = canEnterKey ? 'Enter a new license key on the License page.' : 'Ask your administrator to renew it.';
  if (s.state === 'expiring') return { tone: 'warn', title: `Your Probaline license expires on ${date(s.endsAt)}, in ${days(s.daysLeft)}.`, detail: `Renew it with your provider so nothing stops. ${canEnterKey ? 'Enter the new key on the License page when you have it.' : ''}`.trim() };
  if (s.state === 'grace') return {
    tone: 'warn',
    title: s.reason === 'none' ? 'Your company hasn’t entered a Probaline license yet.' : `Your Probaline license has expired${s.endedAt ? ` (${date(s.endedAt)})` : ''}.`,
    detail: `Everything keeps working until ${date(s.graceUntil)}, ${days(s.daysLeft)} from now. After that, AI requests through Probaline stop. ${action}`,
  };
  if (s.state === 'lapsed') return {
    tone: 'stop',
    title: 'Your Probaline license has expired, and AI requests have stopped.',
    detail: `They stopped on ${date(s.graceUntil)}. You can still sign in and read your evidence. ${action}`,
  };
  return null;
}
export const setReporting = async (config: ReportingConfig) => (await gateway.put('/v1/license/reporting', config)).data;

export const formatDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
