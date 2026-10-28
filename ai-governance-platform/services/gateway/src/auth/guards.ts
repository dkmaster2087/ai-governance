import { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { ApiKeyScope, Principal, UserRole } from './principal';

export interface AccessRule {
  /** Dashboard roles allowed. platform_admin is always allowed. Omit to forbid all users. */
  roles?: UserRole[];
  /** API key scopes allowed (any one is enough). Omit to forbid all API keys. */
  scopes?: ApiKeyScope[];
}

/** Read-only tenant data: anyone in the tenant except plain chat users. */
export const TENANT_READ: AccessRule = { roles: ['tenant_admin', 'tenant_auditor'] };
/** Changing tenant configuration. */
export const TENANT_ADMIN: AccessRule = { roles: ['tenant_admin'] };
/** Platform operator only. */
export const PLATFORM_ADMIN: AccessRule = { roles: [] };

export function isAllowed(principal: Principal | null | undefined, rule: AccessRule): boolean {
  if (!principal) return false;
  if (principal.kind === 'user') {
    if (principal.role === 'platform_admin') return true;
    return rule.roles?.includes(principal.role) ?? false;
  }
  return rule.scopes?.some((s) => principal.scopes.includes(s)) ?? false;
}

/** Route preHandler that rejects callers the rule doesn't allow. */
export function requireAccess(rule: AccessRule): preHandlerAsyncHookHandler {
  return async function accessGuard(request: FastifyRequest, reply: FastifyReply) {
    if (!isAllowed(request.principal, rule)) {
      return reply.status(403).send({ error: 'You do not have permission for this action', code: 'FORBIDDEN' });
    }
  };
}

/** Whether the caller may act on `tenantId` (used for routes that take a tenant in the URL). */
export function canAccessTenant(principal: Principal | null | undefined, tenantId: string): boolean {
  if (!principal) return false;
  if (principal.kind === 'api_key') return principal.tenantId === tenantId;
  return principal.role === 'platform_admin' || principal.homeTenantId === tenantId;
}

/** Route preHandler for `/:tenantId` routes: the URL tenant must be one the caller can access. */
export const requireTenantParam: preHandlerAsyncHookHandler = async (request, reply) => {
  const { tenantId } = (request.params ?? {}) as { tenantId?: string };
  if (!tenantId || !canAccessTenant(request.principal, tenantId)) {
    return reply.status(403).send({ error: 'You do not have access to this tenant', code: 'TENANT_MISMATCH' });
  }
};
