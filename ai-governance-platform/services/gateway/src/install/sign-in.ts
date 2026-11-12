import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import type { UserRole } from '../auth/principal';
import type { DashboardUser, SignInAccounts } from '../services/user-directory';
import type { UserTokenClaims, UserTokenVerifier } from '../middleware/auth.middleware';
import { gatewayKeys } from '../mcp/keys';
import { verifyJwt } from '../mcp/jwt';
import type { SignInConfig } from '../mcp/oidc';

/**
 * Sign-in for a customer-run install (docs/HYBRID.md): the dashboard is served by the gateway, and people sign
 * in to it there, never through us. Two ways, either or both:
 * - their company's identity provider (OIDC: Entra ID, Okta, Google…), set by PROBALINE_SSO_* settings;
 * - local accounts with passwords, for small installs or before SSO is set up.
 * Either way the gateway issues its own session token (ES256, its rotating keys), carrying the same claims a
 * Cloud sign-in does, so every permission check works unchanged. Only people already added on the Users page
 * can sign in; their role is read at sign-in.
 */

const logger = createLogger('gateway:install-sign-in');
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

export const ISSUER = 'probaline-install';
export const AUDIENCE = 'probaline-dashboard';
const SESSION_HOURS = () => Number(process.env.SESSION_HOURS) || 12;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

/** Install sign-in is on for a customer-run install without Cognito, or when SIGN_IN=install says so. */
export const installSignIn = () => {
  const mode = (process.env.SIGN_IN ?? '').toLowerCase();
  if (mode) return mode === 'install';
  return (process.env.LICENSING ?? '').toLowerCase() === 'offline' && !process.env.COGNITO_USER_POOL_ID;
};

/** The one company on an install. */
export const installTenantId = () => process.env.PROBALINE_TENANT_ID || 'tenant_local';

// ── Passwords ────────────────────────────────────────────────────────────────────────────────────────────────

/** At least 12 characters with upper and lower case, a number and a symbol: the same rule Cloud's sign-in uses. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 256) return 'Use at most 256 characters.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) return 'Use upper and lower case letters, a number and a symbol.';
  return null;
}

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function passwordMatches(pw: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), 32, SCRYPT);
  const want = Buffer.from(hash, 'base64');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A temporary password the person changes at first sign-in. Readable, and meets the rule above. */
export function temporaryPassword(): string {
  const words = randomBytes(12).toString('base64url').replace(/[-_]/g, 'x');
  return `${words.slice(0, 6)}-${words.slice(6, 12)}-7Q`;
}

// ── Accounts: password hashes, kept apart from the user records the Users page returns ───────────────────────────

interface Account { tenantId: string; period: string; passwordHash?: string; mustChange?: boolean; failures?: number; lockedUntil?: string; disabled?: boolean }
const accounts = () => collection<Account>('metrics');
const accountKey = (email: string) => ({ tenantId: '_install', period: `account#${email.toLowerCase()}` });

/** The Users page's account store on an install: invitations get a temporary password, shown once to the admin. */
export class LocalAccounts implements SignInAccounts {
  readonly real = true;
  async invite(u: Pick<DashboardUser, 'email'>): Promise<{ temporaryPassword: string }> {
    const temp = temporaryPassword();
    await accounts().put({ ...accountKey(u.email), passwordHash: await hashPassword(temp), mustChange: true, failures: 0 });
    return { temporaryPassword: temp };
  }
  async setRole() { /* read from the user record at sign-in */ }
  async setEnabled(email: string, enabled: boolean) {
    await accounts().update(accountKey(email), { set: { disabled: !enabled }, ifExists: true });
    forgetSessionsOf(email);
  }
  async remove(email: string) {
    await accounts().delete(accountKey(email));
    forgetSessionsOf(email);
  }
}

// ── Sessions ─────────────────────────────────────────────────────────────────────────────────────────────────

const users = () => collection<DashboardUser & Record<string, unknown>>('users');

export interface Session { token: string; expiresAt: string; user: { email: string; givenName: string; familyName: string; role: UserRole; tenantId: string } }

async function issueSession(u: DashboardUser, method: 'password' | 'sso'): Promise<Session> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS() * 3600;
  const token = await gatewayKeys().sign({
    iss: ISSUER, aud: AUDIENCE, sub: u.email, email: u.email, given_name: u.givenName, family_name: u.familyName,
    'custom:tenantId': u.tenantId, 'custom:role': u.role, amr: [method], iat: Math.floor(Date.now() / 1000), exp,
  }, 'probaline-session+jwt');
  await users().update({ tenantId: u.tenantId, email: u.email }, { set: { status: 'active', lastSignInAt: new Date().toISOString() }, ifExists: true });
  // They were just checked: forget any earlier "can't sign in" (say, from before they were turned back on).
  forgetSessionsOf(u.email);
  logger.info('Signed in', { email: u.email, method });
  return { token, expiresAt: new Date(exp * 1000).toISOString(), user: { email: u.email, givenName: u.givenName, familyName: u.familyName, role: u.role, tenantId: u.tenantId } };
}

export class SignInError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode = 401) { super(message); }
}
const WRONG = 'That email and password don’t match.';

/** Someone on the Users page who may sign in now, or null. */
async function member(email: string): Promise<DashboardUser | null> {
  const u = (await users().get({ tenantId: installTenantId(), email: email.toLowerCase() })) as DashboardUser | null;
  return u && u.status !== 'disabled' ? u : null;
}

/** Password sign-in. A temporary password must be replaced first (code NEW_PASSWORD_REQUIRED). */
export async function signInWithPassword(email: string, password: string, newPassword?: string): Promise<Session> {
  const key = accountKey(email);
  const acct = await accounts().get(key);
  const u = await member(email);
  if (!acct?.passwordHash || !u || acct.disabled) {
    // The same answer, and similar time, whether or not the person exists.
    await passwordMatches(password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    throw new SignInError(WRONG, 'WRONG_PASSWORD');
  }
  if (acct.lockedUntil && Date.parse(acct.lockedUntil) > Date.now()) {
    throw new SignInError(`Too many wrong passwords. Try again after ${new Date(acct.lockedUntil).toISOString().slice(11, 16)} UTC, or ask an admin for a new temporary password.`, 'LOCKED', 429);
  }
  if (!(await passwordMatches(password, acct.passwordHash))) {
    const failures = (acct.failures ?? 0) + 1;
    const lock = failures >= MAX_FAILURES ? { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString(), failures: 0 } : { failures };
    await accounts().update(key, { set: lock, ifExists: true });
    logger.warn('Wrong password', { email: email.toLowerCase(), locked: !!lock.lockedUntil });
    throw new SignInError(WRONG, 'WRONG_PASSWORD');
  }
  if (acct.mustChange) {
    if (!newPassword) throw new SignInError('Choose a new password to finish signing in.', 'NEW_PASSWORD_REQUIRED', 409);
    const problem = passwordProblem(newPassword);
    if (problem) throw new SignInError(problem, 'WEAK_PASSWORD', 400);
    if (newPassword === password) throw new SignInError('Choose a password different from the temporary one.', 'WEAK_PASSWORD', 400);
    await accounts().update(key, { set: { passwordHash: await hashPassword(newPassword), mustChange: false, failures: 0 }, remove: ['lockedUntil'], ifExists: true });
  } else if (acct.failures || acct.lockedUntil) {
    await accounts().update(key, { set: { failures: 0 }, remove: ['lockedUntil'], ifExists: true });
  }
  return issueSession(u, 'password');
}

/** The company's identity provider, from PROBALINE_SSO_* settings, or null when SSO isn't set up. */
export function ssoConfig(): (SignInConfig & { name: string; secret: string }) | null {
  const issuer = process.env.PROBALINE_SSO_ISSUER?.trim();
  const clientId = process.env.PROBALINE_SSO_CLIENT_ID?.trim();
  const secret = process.env.PROBALINE_SSO_CLIENT_SECRET?.trim();
  if (!issuer || !clientId || !secret) return null;
  return {
    tenantId: installTenantId(), recordKey: 'signin', issuer, clientId, groupsClaim: 'groups', extraScopes: [], sessionHours: SESSION_HOURS(),
    updatedAt: '', updatedBy: 'environment', name: process.env.PROBALINE_SSO_NAME?.trim() || 'your company account', secret,
  };
}

/** After the identity provider: only someone already on the Users page (matched by email) gets a session. */
export async function signInWithSso(email: string | undefined): Promise<Session> {
  if (!email) throw new SignInError('Your company account has no email address, so it can’t be matched to a Probaline user.', 'SSO_NO_EMAIL', 403);
  const u = await member(email);
  if (!u) throw new SignInError(`${email} isn’t a Probaline user here. Ask an admin to add you on the Users page.`, 'SSO_NOT_A_USER', 403);
  const acct = await accounts().get(accountKey(email));
  if (acct?.disabled) throw new SignInError(`${email} has been turned off. Ask an admin.`, 'SSO_NOT_A_USER', 403);
  return issueSession(u, 'sso');
}

// ── Checking sessions on every request ───────────────────────────────────────────────────────────────────────

/** Whether someone may still sign in, remembered for a minute per process. */
const checked = new Map<string, { ok: boolean; until: number }>();
/** Forget what this process remembers about someone, so a turn-off or removal applies here at once (others within a minute). */
function forgetSessionsOf(email: string) { checked.delete(email.toLowerCase()); }

/** Checks the gateway's own session tokens. Someone turned off or removed is refused at once here, within a minute elsewhere. */
export class InstallSessionVerifier implements UserTokenVerifier {
  async verify(token: string): Promise<UserTokenClaims> {
    const claims = await verifyJwt(token, { issuer: ISSUER, audience: AUDIENCE, key: (h) => gatewayKeys().publicKey(h.kid) });
    const email = String(claims.email ?? '').toLowerCase();
    const hit = checked.get(email);
    let ok = hit && hit.until > Date.now() ? hit.ok : undefined;
    if (ok === undefined) {
      ok = !!(await member(email)) && !(await accounts().get(accountKey(email)))?.disabled;
      checked.set(email, { ok, until: Date.now() + 60_000 });
    }
    if (!ok) throw new Error('This person can no longer sign in');
    return claims as unknown as UserTokenClaims;
  }
}

// ── First start ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Make the install's company and its first admin if they don't exist yet:
 * PROBALINE_COMPANY_NAME, PROBALINE_ADMIN_EMAIL and, optionally, PROBALINE_ADMIN_PASSWORD (a temporary password,
 * changed at first sign-in). Without a password, one is made and written once to the log.
 */
export async function bootstrapInstall(): Promise<void> {
  const tenantId = installTenantId();
  const tenants = collection('tenants');
  if (!(await tenants.get({ tenantId }))) {
    await tenants.put({ tenantId, name: process.env.PROBALINE_COMPANY_NAME || 'My company', status: 'active', plan: 'enterprise', deploymentMode: 'onprem', createdAt: new Date().toISOString(), settings: {} });
    logger.info('Company created', { tenantId });
  }
  const email = process.env.PROBALINE_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email || (await users().get({ tenantId, email }))) return;
  const now = new Date().toISOString();
  await users().put({ tenantId, email, givenName: 'Admin', familyName: '', role: 'tenant_admin', status: 'invited', invitedAt: now, invitedBy: 'install' } as DashboardUser & Record<string, unknown>);
  const given = process.env.PROBALINE_ADMIN_PASSWORD;
  const temp = given || temporaryPassword();
  await accounts().put({ ...accountKey(email), passwordHash: await hashPassword(temp), mustChange: true, failures: 0 });
  if (given) logger.info('First admin created', { email });
  // eslint-disable-next-line no-console
  else console.log(`Probaline: first admin ${email} created. Temporary password (shown once, change it at first sign-in): ${temp}`);
}
