const LICENSE_STORAGE_KEY = 'aegis_tenant_licenses';

export interface TenantLicense {
  licenseKey: string;
  tenantId: string;
  tenantName: string;
  plan: string;
  type: 'cloud' | 'onprem';
  status: 'active' | 'trial' | 'expired' | 'revoked';
  maxUsers: number;
  currentUsers: number;
  issuedAt: string;
  expiresAt: string;
  reportingConfig: {
    usageMetrics: boolean;
    costData: boolean;
    complianceStatus: boolean;
    auditLogs: boolean;
  };
}

export function generateLicenseKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `AEGIS-${seg()}-${seg()}-${seg()}`;
}

export function getAllLicenses(): Record<string, TenantLicense> {
  try {
    const stored = localStorage.getItem(LICENSE_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch { return {}; }
}

export function getTenantLicense(tenantId: string): TenantLicense | null {
  return getAllLicenses()[tenantId] ?? null;
}

export function storeTenantLicense(license: TenantLicense): void {
  const all = getAllLicenses();
  all[license.tenantId] = license;
  localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(all));
}

export function updateTenantLicense(tenantId: string, updates: Partial<TenantLicense>): void {
  const all = getAllLicenses();
  if (all[tenantId]) {
    all[tenantId] = { ...all[tenantId], ...updates };
    localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(all));
  }
}

export function getLicenseList(): TenantLicense[] {
  return Object.values(getAllLicenses());
}

/** Seed default licenses for built-in tenants if not already present */
export function seedDefaultLicenses(): void {
  const existing = getAllLicenses();
  const defaults: TenantLicense[] = [
    { licenseKey: 'AEGIS-DEMO-XXXX-XXXX', tenantId: 'tenant_demo', tenantName: 'Demo Corp', plan: 'professional', type: 'cloud', status: 'active', maxUsers: 50, currentUsers: 45, issuedAt: '2026-01-01', expiresAt: '2027-01-01', reportingConfig: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: true } },
    { licenseKey: 'AEGIS-HC01-XXXX-XXXX', tenantId: 'tenant_healthco', tenantName: 'HealthCo Systems', plan: 'enterprise', type: 'onprem', status: 'active', maxUsers: 200, currentUsers: 120, issuedAt: '2026-01-15', expiresAt: '2027-01-15', reportingConfig: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: false } },
  ];
  let changed = false;
  for (const lic of defaults) {
    if (!existing[lic.tenantId]) {
      existing[lic.tenantId] = lic;
      changed = true;
    }
  }
  if (changed) localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(existing));
}
