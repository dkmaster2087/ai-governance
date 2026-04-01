import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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

// Demo accounts — in production these come from Cognito
const DEMO_ACCOUNTS: Record<string, { password: string; user: AuthUser }> = {
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

const AuthContext = createContext<AuthContextValue | null>(null);
const STORAGE_KEY = 'aegis_auth_user';

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
    const account = DEMO_ACCOUNTS[email.toLowerCase()];
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
