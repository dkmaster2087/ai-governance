import {
  AdminCreateUserCommand, AdminDeleteUserCommand, AdminDisableUserCommand, AdminEnableUserCommand, AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient, UsernameExistsException, UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { allPages, collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import type { UserRole } from '../auth/principal';

const logger = createLogger('gateway:users');

/**
 * Who may sign in to a company's dashboard. Sign-in itself is Cognito's (passwords, MFA, email invitations);
 * this keeps a record per company so its people can be listed and managed, which Cognito can't do by company.
 */

export interface DashboardUser {
  tenantId: string;
  email: string;
  givenName: string;
  familyName: string;
  role: UserRole;
  status: 'invited' | 'active' | 'disabled';
  invitedAt: string;
  invitedBy: string;
  lastSignInAt?: string;
}

export class DirectoryError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode = 400) { super(message); }
}

/** Where people's sign-in accounts live. */
export interface SignInAccounts {
  /** Whether accounts are real (Cognito) or only recorded (local development without Cognito). */
  readonly real: boolean;
  /** On an install, the temporary password to give the person (shown once to the admin). Cognito emails its own. */
  invite(u: Pick<DashboardUser, 'email' | 'givenName' | 'familyName' | 'role' | 'tenantId'>, resend?: boolean): Promise<void | { temporaryPassword?: string }>;
  setRole(email: string, role: UserRole): Promise<void>;
  setEnabled(email: string, enabled: boolean): Promise<void>;
  remove(email: string): Promise<void>;
}

export class CognitoAccounts implements SignInAccounts {
  readonly real = true;
  private client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });
  constructor(private poolId: string) {}

  async invite(u: Pick<DashboardUser, 'email' | 'givenName' | 'familyName' | 'role' | 'tenantId'>, resend = false) {
    try {
      await this.client.send(new AdminCreateUserCommand({
        UserPoolId: this.poolId,
        Username: u.email,
        DesiredDeliveryMediums: ['EMAIL'],
        ...(resend ? { MessageAction: 'RESEND' } : {
          UserAttributes: [
            { Name: 'email', Value: u.email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'given_name', Value: u.givenName },
            { Name: 'family_name', Value: u.familyName },
            { Name: 'custom:tenantId', Value: u.tenantId },
            { Name: 'custom:role', Value: u.role },
          ],
        }),
      }));
    } catch (err) {
      if (err instanceof UsernameExistsException) throw new DirectoryError('Someone with that email already has a Probaline account', 'USER_EXISTS', 409);
      throw err;
    }
  }

  async setRole(email: string, role: UserRole) {
    await this.client.send(new AdminUpdateUserAttributesCommand({ UserPoolId: this.poolId, Username: email, UserAttributes: [{ Name: 'custom:role', Value: role }] }));
  }

  async setEnabled(email: string, enabled: boolean) {
    await this.client.send(enabled ? new AdminEnableUserCommand({ UserPoolId: this.poolId, Username: email }) : new AdminDisableUserCommand({ UserPoolId: this.poolId, Username: email }));
  }

  async remove(email: string) {
    try {
      await this.client.send(new AdminDeleteUserCommand({ UserPoolId: this.poolId, Username: email }));
    } catch (err) {
      if (!(err instanceof UserNotFoundException)) throw err;
    }
  }
}

/** Local development without Cognito: people are recorded only; the dashboard's demo accounts sign them in. */
export class RecordedAccounts implements SignInAccounts {
  readonly real = false;
  async invite() { /* nothing to send */ }
  async setRole() {}
  async setEnabled() {}
  async remove() {}
}

const users = () => collection<DashboardUser & Record<string, unknown>>('users');
const key = (tenantId: string, email: string) => ({ tenantId, email: email.toLowerCase() });

export class UserDirectory {
  constructor(private accounts: SignInAccounts) {}

  get real() { return this.accounts.real; }

  list = async (tenantId: string) => (await allPages((after) => users().query({ partition: tenantId, after }))) as DashboardUser[];
  get = async (tenantId: string, email: string) => (await users().get(key(tenantId, email))) as DashboardUser | null;

  async invite(input: Pick<DashboardUser, 'email' | 'givenName' | 'familyName' | 'role' | 'tenantId'>, invitedBy: string): Promise<DashboardUser & { temporaryPassword?: string }> {
    const email = input.email.toLowerCase();
    if (await this.get(input.tenantId, email)) throw new DirectoryError('That person is already in this company', 'USER_EXISTS', 409);
    // The account first, so a failed invitation leaves no half-made user behind.
    const made = await this.accounts.invite({ ...input, email });
    const user: DashboardUser = { ...input, email, status: 'invited', invitedAt: new Date().toISOString(), invitedBy };
    await users().put(user as DashboardUser & Record<string, unknown>);
    logger.info('User invited', { tenantId: input.tenantId, email, role: input.role, by: invitedBy });
    return { ...user, ...(made?.temporaryPassword ? { temporaryPassword: made.temporaryPassword } : {}) };
  }

  /** Cognito: the invitation email again. An install: a new temporary password, returned to show once. */
  async resend(user: DashboardUser): Promise<{ temporaryPassword?: string }> {
    return (await this.accounts.invite(user, true)) || {};
  }

  async setRole(user: DashboardUser, role: UserRole) {
    await this.accounts.setRole(user.email, role);
    return (await users().update(key(user.tenantId, user.email), { set: { role }, ifExists: true })) as DashboardUser;
  }

  async setEnabled(user: DashboardUser, enabled: boolean) {
    await this.accounts.setEnabled(user.email, enabled);
    const status = enabled ? (user.lastSignInAt ? 'active' : 'invited') : 'disabled';
    return (await users().update(key(user.tenantId, user.email), { set: { status }, ifExists: true })) as DashboardUser;
  }

  async remove(user: DashboardUser) {
    await this.accounts.remove(user.email);
    await users().delete(key(user.tenantId, user.email));
  }

  /** Called when someone signs in: they're no longer just invited. */
  async signedIn(tenantId: string, email: string) {
    const u = await this.get(tenantId, email);
    if (!u || u.status === 'disabled') return;
    await users().update(key(tenantId, email), { set: { status: 'active', lastSignInAt: new Date().toISOString() }, ifExists: true });
  }
}

let shared: UserDirectory | null = null;
export const userDirectory = () => (shared ??= new UserDirectory(
  process.env.COGNITO_USER_POOL_ID ? new CognitoAccounts(process.env.COGNITO_USER_POOL_ID)
    // A customer-run install signs people in itself (install/sign-in.ts). Loaded here: that module uses this one's types.
    : (require('../install/sign-in') as typeof import('../install/sign-in')).installSignIn()
      ? new (require('../install/sign-in') as typeof import('../install/sign-in')).LocalAccounts()
      : new RecordedAccounts(),
));
export const setUserDirectory = (d: UserDirectory | null) => { shared = d; };
