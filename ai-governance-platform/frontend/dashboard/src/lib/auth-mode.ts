/**
 * How the dashboard signs users in.
 * - cognito: real sign-in against the Cognito user pool (any deployed environment).
 * - dev: built-in demo accounts, only for `vite dev` without Cognito settings (or VITE_AUTH_MODE=dev).
 * - unconfigured: a production build with no Cognito settings; sign-in is refused.
 *
 * Written as a single expression of build-time constants so production builds drop the demo-account code.
 */
export const DEV_AUTH: boolean =
  import.meta.env.VITE_AUTH_MODE === 'dev' ||
  (!import.meta.env.VITE_COGNITO_USER_POOL_ID && import.meta.env.DEV);

export type AuthMode = 'cognito' | 'dev' | 'unconfigured';

export const AUTH_MODE: AuthMode = DEV_AUTH
  ? 'dev'
  : import.meta.env.VITE_COGNITO_USER_POOL_ID && import.meta.env.VITE_COGNITO_CLIENT_ID
    ? 'cognito'
    : 'unconfigured';
