import { createContext, useContext, useState, ReactNode } from 'react';

export type UserRole = 'platform_admin' | 'tenant_user';

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
  isAdmin: boolean;
}

// Built-in demo accounts
const BUILTIN_ACCOUNTS: Record<string, { password: string; user: AuthUser }> = {
  'admin@platform.com': {
    password: 'admin123',
    user: {
      userId: 'user_platform_admin',
      name: 'Platform Admin',
      email: 'admin@platform.com',
      role: 'platform_admin',
      tenantId: 'tenant_platform',
      tenantName: 'Aegis AI Platform',
    },
  },
  'admin@democorp.com': {
    password: 'demo123',
    user: {
      userId: 'user_demo_admin',
      name: 'Demo Corp Admin',
      email: 'admin@democorp.com',
      role: 'tenant_user',
      tenantId: 'tenant_demo',
      tenantName: 'Demo Corp',
    },
  },
  'admin@healthco.com': {
    password: 'health123',
    user: {
      userId: 'user_healthco_admin',
      name: 'HealthCo Admin',
      email: 'admin@healthco.com',
      role: 'tenant_user',
      tenantId: 'tenant_healthco',
      tenantName: 'HealthCo Systems',
    },
  },
};

const STORAGE_KEY = 'aegis_auth_user';
const DYNAMIC_ACCOUNTS_KEY = 'aegis_dynamic_accounts';

/** Get all accounts — built-in + dynamically registered */
function getAllAccounts(): Record<string, { password: string; user: AuthUser }> {
  const dynamic = getDynamicAccounts();
  return { ...BUILTIN_ACCOUNTS, ...dynamic };
}

function getDynamicAccounts(): Record<string, { password: string; user: AuthUser }> {
  try {
    const stored = localStorage.getItem(DYNAMIC_ACCOUNTS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/** Register a new tenant admin account — called when onboarding a tenant */
export function registerTenantAccount(opts: {
  email: string;
  password: string;
  name: string;
  tenantId: string;
  tenantName: string;
}) {
  const accounts = getDynamicAccounts();
  const key = opts.email.toLowerCase();
  accounts[key] = {
    password: opts.password,
    user: {
      userId: `user_${opts.tenantId}_admin`,
      name: opts.name,
      email: opts.email,
      role: 'tenant_user',
      tenantId: opts.tenantId,
      tenantName: opts.tenantName,
    },
  };
  localStorage.setItem(DYNAMIC_ACCOUNTS_KEY, JSON.stringify(accounts));
}

/** Get all registered accounts for display on login page */
export function getRegisteredAccounts(): Array<{ email: string; password: string; role: string; badge: string }> {
  const all = getAllAccounts();
  return Object.entries(all).map(([email, acc]) => ({
    email,
    password: acc.password,
    role: acc.user.role === 'platform_admin' ? 'Platform Admin' : 'Tenant Admin',
    badge: acc.user.tenantName,
  }));
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const login = async (email: string, password: string) => {
    const accounts = getAllAccounts();
    const account = accounts[email.toLowerCase()];
    if (!account) return { success: false, error: 'No account found with that email' };
    if (account.password !== password) return { success: false, error: 'Incorrect password' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account.user));
    setUser(account.user);
    return { success: true };
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isAdmin: user?.role === 'platform_admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
