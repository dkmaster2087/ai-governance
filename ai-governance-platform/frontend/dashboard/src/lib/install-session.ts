import axios from 'axios';

/**
 * Sign-in on a customer-run install (VITE_AUTH_MODE=install): the gateway serving this dashboard signs people
 * in itself, with a password or the company's identity provider, and returns its own session token. The token
 * lives in this browser's storage for the session's length; nothing goes to Probaline.
 */

const KEY = 'probaline:session';

export interface InstallSession { token: string; expiresAt: string }
export interface SignInMethods { password: boolean; sso: { name: string } | null }

export function currentSession(): InstallSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as InstallSession | null;
    return s && Date.parse(s.expiresAt) > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function keep(s: InstallSession) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: signed in for this page only */ }
}

export function forget() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}

/** The token's claims (it's checked by the gateway on every request; here it's only read). */
export function claimsOf(token: string): Record<string, unknown> {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

/** A session from a token alone (company sign-in hands one back in the page address). */
export function sessionFromToken(token: string): InstallSession | null {
  const exp = Number(claimsOf(token).exp);
  return exp ? { token, expiresAt: new Date(exp * 1000).toISOString() } : null;
}

export type PasswordStep =
  | { status: 'signed_in'; session: InstallSession }
  | { status: 'new_password_required' }
  | { status: 'error'; error: string };

export async function signInWithPassword(email: string, password: string, newPassword?: string): Promise<PasswordStep> {
  try {
    const { data } = await axios.post<{ token: string; expiresAt: string }>('/api/v1/auth/password', { email, password, ...(newPassword ? { newPassword } : {}) });
    return { status: 'signed_in', session: { token: data.token, expiresAt: data.expiresAt } };
  } catch (err) {
    const r = (err as { response?: { status?: number; data?: { error?: string; code?: string } } }).response;
    if (r?.data?.code === 'NEW_PASSWORD_REQUIRED') return { status: 'new_password_required' };
    return { status: 'error', error: r?.data?.error ?? 'Sign-in failed. Try again.' };
  }
}

export async function signInMethods(): Promise<SignInMethods> {
  try {
    return (await axios.get<SignInMethods>('/api/v1/auth/methods')).data;
  } catch {
    return { password: true, sso: null };
  }
}

/** Company sign-in: the gateway sends the browser to the identity provider and back. */
export const SSO_START = '/api/v1/auth/sso/start';
