/**
 * Production security configuration.
 * Controls auth behavior, rate limiting, CORS, and input validation.
 */

export interface SecurityConfig {
  /** Whether to enforce real API key validation (false = allow test-key) */
  enforceApiKeys: boolean;
  /** Whether to allow the legacy 'test-key' token */
  allowTestKey: boolean;
  /** Maximum request body size in bytes */
  maxBodySize: number;
  /** Maximum prompt length in characters */
  maxPromptLength: number;
  /** Allowed origins for CORS (empty = all) */
  allowedOrigins: string[];
  /** Global rate limit (requests per minute) */
  globalRateLimit: number;
  /** Whether to require x-tenant-id header */
  requireTenantId: boolean;
  /** Whether to log full request bodies (disable in production for PII safety) */
  logRequestBodies: boolean;
  /** API key cache TTL in milliseconds */
  keyCacheTtlMs: number;
  /**
   * Dev-only sign-in shortcut: accepts `Bearer test-key` with x-tenant-id / x-dev-role headers.
   * Opt-in via AUTH_DEV_MODE=true and refused outside dev/local/test stages.
   */
  devAuth: boolean;
  /** Cognito settings for verifying dashboard user tokens. Unset = user tokens are rejected. */
  cognito?: { userPoolId: string; clientId: string };
  /**
   * What to do when the policy engine or data protection service can't be reached.
   * 'closed' blocks the request (default); 'open' lets it through unchecked. Tenants can override.
   */
  governanceFailMode: 'open' | 'closed';
}

const DEV_AUTH_STAGES = ['dev', 'local', 'test'];

const DEV_CONFIG: SecurityConfig = {
  enforceApiKeys: false,
  allowTestKey: true,
  maxBodySize: 10 * 1024 * 1024, // 10MB
  maxPromptLength: 100000,
  allowedOrigins: ['http://localhost:5173', 'http://localhost:5174'],
  globalRateLimit: 100,
  requireTenantId: true,
  logRequestBodies: false,
  keyCacheTtlMs: 60000,
  devAuth: false,
  governanceFailMode: 'closed',
};

const PROD_CONFIG: SecurityConfig = {
  enforceApiKeys: true,
  allowTestKey: false,
  maxBodySize: 5 * 1024 * 1024, // 5MB
  maxPromptLength: 50000,
  allowedOrigins: [], // Set via ALLOWED_ORIGINS env var
  globalRateLimit: 500,
  requireTenantId: true,
  logRequestBodies: false,
  keyCacheTtlMs: 60000,
  devAuth: false,
  governanceFailMode: 'closed',
};

export function getSecurityConfig(): SecurityConfig {
  const stage = process.env.STAGE || 'dev';
  const config = stage === 'prod' || stage === 'production' ? { ...PROD_CONFIG } : { ...DEV_CONFIG };

  // Override from environment
  if (process.env.ALLOWED_ORIGINS) {
    config.allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  }
  if (process.env.GLOBAL_RATE_LIMIT) {
    config.globalRateLimit = parseInt(process.env.GLOBAL_RATE_LIMIT, 10);
  }
  if (process.env.ENFORCE_API_KEYS === 'true') {
    config.enforceApiKeys = true;
    config.allowTestKey = false;
  }

  if (process.env.AUTH_DEV_MODE === 'true') {
    if (!DEV_AUTH_STAGES.includes(stage)) {
      throw new Error(`AUTH_DEV_MODE=true is not allowed when STAGE=${stage}`);
    }
    config.devAuth = true;
  }
  config.allowTestKey = config.devAuth;

  if (process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID) {
    config.cognito = {
      userPoolId: process.env.COGNITO_USER_POOL_ID,
      clientId: process.env.COGNITO_CLIENT_ID,
    };
  }

  const failMode = process.env.GOVERNANCE_FAIL_MODE;
  if (failMode === 'open' || failMode === 'closed') {
    config.governanceFailMode = failMode;
  }

  return config;
}
