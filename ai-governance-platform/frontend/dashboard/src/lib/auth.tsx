import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import type { CognitoUserSession } from 'amazon-cognito-identity-js';
import { AUTH_MODE, DEV_AUTH } from './auth-mode';
import { createApiClient, setAuthHeaderProvider, setSessionTenant, UNAUTHORIZED_EVENT } from './http';
import * as cognito from './cognito';
import * as devAccounts from './dev-accounts';

export { AUTH_MODE } from './auth-mode';

export type UserRole = 'platform_admin' | 'tenant_admin' | 'tenant_auditor' | 'tenant_user';

export interface AuthUser {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId: string;
  tenantName: string;
}

/** Result of a sign-in step. `challenge` means the user must provide something else to finish. */
export interface LoginResult {
  success: boolean;
  error?: string;
  challenge?: 'new_password' | 'mfa';
}

interface AuthContextValue {
  user: AuthUser | null;
  /** True while an existing session is being restored on page load. */
  restoring: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  /** Answer a sign-in challenge (a new password, or an authenticator code). */
  completeChallenge: (challenge: 'new_password' | 'mfa', value: string) => Promise<LoginResult>;
  logout: () => void;
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
  isAuditor: boolean;
  /** platform_admin or tenant_admin */
  isAdmin: boolean;
  /** Can view audit logs */
  canViewAudit: boolean;
  /** False for tenant_user, who uses AI through apps and has no dashboard. */
  hasDashboardAccess: boolean;
}

const ROLES: UserRole[] = ['platform_admin', 'tenant_admin', 'tenant_auditor', 'tenant_user'];
const STORAGE_KEY = 'aegis_auth_user';

/** Users live in the identity provider, not in this app, unless we're on local demo accounts. */
export const usersManagedExternally = !DEV_AUTH;

// ── Demo-account helpers (no-ops outside local dev) ─────────────────────────

export function registerTenantAccount(opts: {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  tenantId: string;
  tenantName: string;
}): boolean {
  if (!DEV_AUTH) return false;
  devAccounts.registerDevAccount(opts);
  return true;
}

export function getTenantUsers(tenantId: string): AuthUser[] {
  return DEV_AUTH ? devAccounts.getDevTenantUsers(tenantId) : [];
}

export function deleteUserAccount(email: string) {
  if (DEV_AUTH) devAccounts.deleteDevAccount(email);
}

export function getRegisteredAccounts(): Array<{ email: string; password: string; role: string; badge: string }> {
  return DEV_AUTH ? devAccounts.getDevAccounts() : [];
}

// ── Session plumbing ────────────────────────────────────────────────────────

function readStoredUser(): AuthUser | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as AuthUser) : null;
  } catch {
    return null;
  }
}

function userFromSession(session: CognitoUserSession): AuthUser | null {
  const claims = session.getIdToken().decodePayload() as Record<string, string>;
  const role = claims['custom:role'] as UserRole;
  const tenantId = claims['custom:tenantId'];
  if (!tenantId || !ROLES.includes(role)) return null;
  const name = [claims.given_name, claims.family_name].filter(Boolean).join(' ') || claims.email || 'User';
  return {
    userId: claims.sub,
    name,
    email: claims.email ?? '',
    role,
    tenantId,
    tenantName: role === 'platform_admin' ? 'Aegis AI Platform' : tenantId,
  };
}

// Every API client asks this for credentials before each request.
setAuthHeaderProvider(async (): Promise<Record<string, string>> => {
  if (AUTH_MODE === 'cognito') {
    const session = await cognito.currentSession();
    return session ? { authorization: `Bearer ${session.getIdToken().getJwtToken()}` } : {};
  }
  if (AUTH_MODE === 'dev') {
    const user = readStoredUser();
    if (!user) return {};
    // Matches the gateway's AUTH_DEV_MODE, which only exists in dev/local stages.
    return {
      authorization: 'Bearer test-key',
      'x-tenant-id': user.tenantId,
      'x-dev-role': user.role,
      'x-user-id': user.userId,
    };
  }
  return {};
});

const gatewayApi = createApiClient('/api');

/** Best-effort lookup of the tenant's display name (the token only carries the ID). */
async function withTenantName(user: AuthUser): Promise<AuthUser> {
  if (user.role === 'platform_admin') return user;
  try {
    const { data } = await gatewayApi.get(`/v1/tenants/${encodeURIComponent(user.tenantId)}`);
    return data?.name ? { ...user, tenantName: data.name } : user;
  } catch {
    return user;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => (AUTH_MODE === 'dev' ? readStoredUser() : null));
  const [restoring, setRestoring] = useState(AUTH_MODE === 'cognito');

  const signedIn = useCallback(async (session: CognitoUserSession): Promise<LoginResult> => {
    const base = userFromSession(session);
    if (!base) {
      cognito.signOut();
      return { success: false, error: 'Your account has no tenant or role assigned. Contact your administrator.' };
    }
    setUser(base);
    setUser(await withTenantName(base));
    return { success: true };
  }, []);

  // Restore an existing Cognito session on load.
  useEffect(() => {
    if (AUTH_MODE !== 'cognito') return;
    let cancelled = false;
    cognito.currentSession().then(async (session) => {
      if (!cancelled && session) await signedIn(session);
      if (!cancelled) setRestoring(false);
    });
    return () => { cancelled = true; };
  }, [signedIn]);

  const logout = useCallback(() => {
    if (AUTH_MODE === 'cognito') cognito.signOut();
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  // The backend rejected our credentials (expired or revoked): sign out.
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, logout);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, logout);
  }, [logout]);

  const fromStep = async (step: cognito.SignInStep): Promise<LoginResult> => {
    switch (step.status) {
      case 'signed_in': return signedIn(step.session);
      case 'new_password_required': return { success: false, challenge: 'new_password' };
      case 'mfa_required': return { success: false, challenge: 'mfa' };
      default: return { success: false, error: step.error };
    }
  };

  const login = async (email: string, password: string): Promise<LoginResult> => {
    if (AUTH_MODE === 'cognito') return fromStep(await cognito.signIn(email, password));
    if (AUTH_MODE === 'dev') {
      const account = devAccounts.getAllAccounts()[email.toLowerCase()];
      if (!account || account.password !== password) return { success: false, error: 'Incorrect email or password' };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(account.user));
      setUser(account.user);
      return { success: true };
    }
    return { success: false, error: 'Sign-in is not configured for this deployment.' };
  };

  const completeChallenge = async (challenge: 'new_password' | 'mfa', value: string): Promise<LoginResult> => {
    if (AUTH_MODE !== 'cognito') return { success: false, error: 'Not supported' };
    const step = challenge === 'new_password' ? await cognito.completeNewPassword(value) : await cognito.submitMfaCode(value);
    return fromStep(step);
  };

  // Kept in sync during render so data requests made by child pages always use the current tenant.
  setSessionTenant(user?.tenantId ?? null);

  const role = user?.role;
  const isPlatformAdmin = role === 'platform_admin';
  const isTenantAdmin = role === 'tenant_admin';
  const isAuditor = role === 'tenant_auditor';
  const hasDashboardAccess = !!role && role !== 'tenant_user';

  return (
    <AuthContext.Provider value={{
      user, restoring, login, completeChallenge, logout,
      isPlatformAdmin,
      isTenantAdmin,
      isAuditor,
      isAdmin: isPlatformAdmin || isTenantAdmin,
      canViewAudit: isPlatformAdmin || isTenantAdmin || isAuditor,
      hasDashboardAccess,
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
