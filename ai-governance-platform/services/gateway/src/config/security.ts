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
}

const stage = process.env.STAGE || 'dev';

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
};

export function getSecurityConfig(): SecurityConfig {
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

  return config;
}
