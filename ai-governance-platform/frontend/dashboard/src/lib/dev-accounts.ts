/**
 * Local demo accounts for `vite dev` only. Production builds use Cognito and this module is dropped
 * from the bundle (see DEV_AUTH in auth-mode.ts). Never put real credentials here.
 */
import type { AuthUser, UserRole } from './auth';

const BUILTIN_ACCOUNTS: Record<string, { password: string; user: AuthUser }> = {
  'admin@platform.com': {
    password: 'admin123',
    user: { userId: 'user_platform_admin', name: 'Platform Admin', email: 'admin@platform.com', role: 'platform_admin', tenantId: 'tenant_platform', tenantName: 'Aegis AI Platform' },
  },
  'admin@democorp.com': {
    password: 'demo123',
    user: { userId: 'user_demo_admin', name: 'Demo Corp Admin', email: 'admin@democorp.com', role: 'tenant_admin', tenantId: 'tenant_demo', tenantName: 'Demo Corp' },
  },
  'admin@healthco.com': {
    password: 'health123',
    user: { userId: 'user_healthco_admin', name: 'HealthCo Admin', email: 'admin@healthco.com', role: 'tenant_admin', tenantId: 'tenant_healthco', tenantName: 'HealthCo Systems' },
  },
};

const DYNAMIC_ACCOUNTS_KEY = 'aegis_dynamic_accounts';

export function getAllAccounts(): Record<string, { password: string; user: AuthUser }> {
  return { ...BUILTIN_ACCOUNTS, ...getDynamicAccounts() };
}

function getDynamicAccounts(): Record<string, { password: string; user: AuthUser }> {
  try {
    const stored = localStorage.getItem(DYNAMIC_ACCOUNTS_KEY);
    if (!stored) return {};
    const accounts = JSON.parse(stored) as Record<string, { password: string; user: AuthUser }>;
    return accounts;
  } catch { return {}; }
}

export function registerDevAccount(opts: {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  tenantId: string;
  tenantName: string;
}) {
  const accounts = getDynamicAccounts();
  accounts[opts.email.toLowerCase()] = {
    password: opts.password,
    user: {
      userId: `user_${Date.now().toString(36)}`,
      name: opts.name,
      email: opts.email,
      role: opts.role,
      tenantId: opts.tenantId,
      tenantName: opts.tenantName,
    },
  };
  localStorage.setItem(DYNAMIC_ACCOUNTS_KEY, JSON.stringify(accounts));
}

/** Get users for a specific tenant */
export function getDevTenantUsers(tenantId: string): AuthUser[] {
  const all = getAllAccounts();
  return Object.values(all)
    .filter((a) => a.user.tenantId === tenantId)
    .map((a) => a.user);
}

/** Delete a user account */
export function deleteDevAccount(email: string) {
  const accounts = getDynamicAccounts();
  delete accounts[email.toLowerCase()];
  localStorage.setItem(DYNAMIC_ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function getDevAccounts(): Array<{ email: string; password: string; role: string; badge: string }> {
  const roleLabels: Record<UserRole, string> = {
    platform_admin: 'Platform Admin',
    tenant_admin: 'Tenant Admin',
    tenant_auditor: 'Auditor',
    tenant_user: 'User',
  };
  const all = getAllAccounts();
  return Object.entries(all).map(([email, acc]) => ({
    email,
    password: acc.password,
    role: roleLabels[acc.user.role] || acc.user.role,
    badge: acc.user.tenantName,
  }));
}

