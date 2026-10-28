import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';

export type SignInStep =
  | { status: 'signed_in'; session: CognitoUserSession }
  | { status: 'new_password_required' }
  | { status: 'mfa_required' }
  | { status: 'error'; error: string };

let pool: CognitoUserPool | null = null;
/** The user part-way through a sign-in challenge (new password or MFA code). */
let pendingUser: CognitoUser | null = null;

function getPool(): CognitoUserPool {
  if (!pool) {
    pool = new CognitoUserPool({
      UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID!,
      ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID!,
    });
  }
  return pool;
}

function friendlyError(err: unknown): string {
  const e = err as { code?: string; name?: string; message?: string };
  switch (e?.code ?? e?.name) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
      return 'Incorrect email or password';
    case 'PasswordResetRequiredException':
      return 'You need to reset your password before signing in';
    case 'CodeMismatchException':
      return 'That code is incorrect';
    case 'InvalidPasswordException':
      return e.message ?? 'Password does not meet the requirements';
    default:
      return e?.message ?? 'Sign-in failed';
  }
}

function callbacks(user: CognitoUser, resolve: (step: SignInStep) => void) {
  return {
    onSuccess: (session: CognitoUserSession) => {
      pendingUser = null;
      resolve({ status: 'signed_in', session });
    },
    onFailure: (err: unknown) => resolve({ status: 'error', error: friendlyError(err) }),
    newPasswordRequired: () => {
      pendingUser = user;
      resolve({ status: 'new_password_required' });
    },
    totpRequired: () => {
      pendingUser = user;
      resolve({ status: 'mfa_required' });
    },
    mfaRequired: () => {
      pendingUser = user;
      resolve({ status: 'mfa_required' });
    },
  };
}

export function signIn(email: string, password: string): Promise<SignInStep> {
  const user = new CognitoUser({ Username: email, Pool: getPool() });
  return new Promise((resolve) => {
    user.authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), callbacks(user, resolve));
  });
}

/** Finish sign-in for an invited user who must choose a new password. */
export function completeNewPassword(newPassword: string): Promise<SignInStep> {
  const user = pendingUser;
  if (!user) return Promise.resolve({ status: 'error', error: 'Sign-in expired, please start again' });
  return new Promise((resolve) => user.completeNewPasswordChallenge(newPassword, {}, callbacks(user, resolve)));
}

/** Finish sign-in with an authenticator app code. */
export function submitMfaCode(code: string): Promise<SignInStep> {
  const user = pendingUser;
  if (!user) return Promise.resolve({ status: 'error', error: 'Sign-in expired, please start again' });
  return new Promise((resolve) => user.sendMFACode(code, callbacks(user, resolve), 'SOFTWARE_TOKEN_MFA'));
}

/** The current session, refreshed if its tokens have expired; null when signed out. */
export function currentSession(): Promise<CognitoUserSession | null> {
  const user = getPool().getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      resolve(!err && session?.isValid() ? session : null);
    });
  });
}

export function signOut() {
  pendingUser = null;
  getPool().getCurrentUser()?.signOut();
}
