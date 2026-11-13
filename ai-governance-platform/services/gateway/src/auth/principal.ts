/**
 * Who is calling the gateway, resolved once per request by the auth middleware.
 *
 * - api_key: a machine caller (app, extension, on-prem agent). Tenant comes from the key record,
 *   never from headers. `userId` is the end user the app says it is acting for (attribution only).
 * - user:    a dashboard user signed in through Cognito. Tenant and role come from verified token claims.
 */
export type UserRole = 'platform_admin' | 'tenant_admin' | 'tenant_auditor' | 'tenant_user';

export const USER_ROLES: readonly UserRole[] = ['platform_admin', 'tenant_admin', 'tenant_auditor', 'tenant_user'];

/** API key scopes. Keys created before scopes were enforced default to ['chat', 'models']. */
export type ApiKeyScope = 'chat' | 'models' | 'shadow_ai:ingest' | 'reporting:ingest' | 'mcp' | 'guardrails';

/** `mcp`: connect an agent to the company's MCP servers. `guardrails`: another AI gateway calls Probaline's checks. */
export const API_KEY_SCOPES: readonly ApiKeyScope[] = ['chat', 'models', 'shadow_ai:ingest', 'reporting:ingest', 'mcp', 'guardrails'];

export type Principal =
  | {
      kind: 'api_key';
      tenantId: string;
      keyId: string;
      scopes: string[];
      /** Calls a minute this key may make (counted across every gateway instance). */
      rateLimit?: number;
      /** Daily caps on tokens and estimated spend (services/key-spend.ts). */
      dailyTokenLimit?: number;
      dailySpendLimitUsd?: number;
      userId: string;
      appId: string;
    }
  | {
      kind: 'user';
      /** The tenant the user belongs to (from the token). */
      homeTenantId: string;
      userId: string;
      email?: string;
      role: UserRole;
    };

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}
