import { createContext, useContext, useState, ReactNode } from 'react';

export type UserRole = 'platform_admin' | 'tenant_admin' | 'tenant_auditor' | 'tenant_user';

export interface AuthUser {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId: string;
  tenantName: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
  isAuditor: boolean;
  /** platform_admin or tenant_admin */
  isAdmin: boolean;
  /** Can view audit logs */
  canViewAudit: boolean;
  /** Can only access chat */
  isChatOnly: boolean;
}

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

const STORAGE_KEY = 'aegis_auth_user';
const DYNAMIC_ACCOUNTS_KEY = 'aegis_dynamic_accounts';

function getAllAccounts(): Record<string, { password: string; user: AuthUser }> {
  return { ...BUILTIN_ACCOUNTS, ...getDynamicAccounts() };
}

function getDynamicAccounts(): Record<string, { password: string; user: AuthUser }> {
  try {
    const stored = localStorage.getItem(DYNAMIC_ACCOUNTS_KEY);
    if (!stored) return {};
    const accounts = JSON.parse(stored) as Record<string, { password: string; user: AuthUser }>;
    // Migration: accounts created before the role system had 'tenant_user' role
    // but were actually tenant admins (created via onboarding). Upgrade them.
    let migrated = false;
    const tenantCounts: Record<string, number> = {};
    for (const acc of Object.values(accounts)) {
      const tid = acc.user?.tenantId;
      if (tid) tenantCounts[tid] = (tenantCounts[tid] || 0) + 1;
    }
    for (const acc of Object.values(accounts)) {
      // If this is the only user for the tenant and has tenant_user role, upgrade to admin
      if (acc.user?.role === 'tenant_user' && tenantCounts[acc.user.tenantId] === 1) {
        acc.user.role = 'tenant_admin';
        migrated = true;
      }
    }
    if (migrated) localStorage.setItem(DYNAMIC_ACCOUNTS_KEY, JSON.stringify(accounts));
    return accounts;
  } catch { return {}; }
}

export function registerTenantAccount(opts: {
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
export function getTenantUsers(tenantId: string): AuthUser[] {
  const all = getAllAccounts();
  return Object.values(all)
    .filter((a) => a.user.tenantId === tenantId)
    .map((a) => a.user);
}

/** Delete a user account */
export function deleteUserAccount(email: string) {
  const accounts = getDynamicAccounts();
  delete accounts[email.toLowerCase()];
  localStorage.setItem(DYNAMIC_ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function getRegisteredAccounts(): Array<{ email: string; password: string; role: string; badge: string }> {
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

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      // Re-check against current accounts to pick up role migrations
      const accounts = getAllAccounts();
      const current = accounts[parsed.email?.toLowerCase()];
      if (current && current.user.role !== parsed.role) {
        const updated = { ...parsed, role: current.user.role };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      }
      return parsed;
    } catch { return null; }
  });

  const login = async (email: string, password: string) => {
    const account = getAllAccounts()[email.toLowerCase()];
    if (!account) return { success: false, error: 'No account found with that email' };
    if (account.password !== password) return { success: false, error: 'Incorrect password' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account.user));
    setUser(account.user);
    return { success: true };
  };

  const logout = () => { localStorage.removeItem(STORAGE_KEY); setUser(null); };

  const role = user?.role;
  const isPlatformAdmin = role === 'platform_admin';
  const isTenantAdmin = role === 'tenant_admin';
  const isAuditor = role === 'tenant_auditor';
  const isChatOnly = role === 'tenant_user';

  return (
    <AuthContext.Provider value={{
      user, login, logout,
      isPlatformAdmin,
      isTenantAdmin,
      isAuditor,
      isAdmin: isPlatformAdmin || isTenantAdmin,
      canViewAudit: isPlatformAdmin || isTenantAdmin || isAuditor,
      isChatOnly,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
