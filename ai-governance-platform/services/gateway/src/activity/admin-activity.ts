import { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ActivityInput, ActivityLog, ActivityOutcome, Actor, activityLog } from './activity-log';

/**
 * Records every change a person makes through the API (rules, keys, MCP servers, approvals, settings…) as
 * admin activity, from one hook rather than in each route, so a new route can't forget to. Only the route's
 * IDs and the created record's ID are kept, never request or response bodies.
 */

/** Route (method + Fastify route pattern) → action name. Changes not listed are recorded as `<area>.changed`. */
export const ADMIN_ACTIONS: Record<string, string> = {
  'POST /v1/rules': 'rule.created',
  'PATCH /v1/rules/:policyId/:ruleId': 'rule.updated',
  'DELETE /v1/rules/:policyId/:ruleId': 'rule.deleted',
  'PUT /v1/gateway/settings': 'gateway_settings.updated',
  'POST /v1/policies': 'policy.created',
  'PUT /v1/policies/:policyId': 'policy.updated',
  'DELETE /v1/policies/:policyId': 'policy.deleted',
  'POST /v1/api-keys': 'api_key.created',
  'POST /v1/api-keys/:keyId/revoke': 'api_key.revoked',
  'POST /v1/api-keys/:keyId/rotate': 'api_key.rotated',
  'DELETE /v1/api-keys/:keyId': 'api_key.deleted',
  'POST /v1/models/config': 'model.added',
  'PUT /v1/models/config/:modelConfigId': 'model.updated',
  'DELETE /v1/models/config/:modelConfigId': 'model.deleted',
  'POST /v1/models/config/:modelConfigId/test': 'model.tested',
  'POST /v1/alerts/rules': 'alert_rule.created',
  'POST /v1/alerts/test': 'alert.tested',
  'PUT /v1/shadow-ai/policy': 'shadow_ai_policy.updated',
  'POST /v1/compliance/enable/:tenantId/:framework': 'compliance.enabled',
  'DELETE /v1/compliance/disable/:tenantId/:framework': 'compliance.disabled',
  'POST /v1/compliance/assess/:tenantId/:framework': 'compliance.assessed',
  'POST /v1/tenants': 'tenant.created',
  'PUT /v1/tenants/:tenantId': 'tenant.updated',
  'POST /v1/tenants/:tenantId/suspend': 'tenant.suspended',
  'POST /v1/tenants/:tenantId/activate': 'tenant.activated',
  'PUT /v1/license/reporting': 'reporting_license.updated',
  'POST /v1/tenants/:tenantId/licenses': 'license.issued',
  'POST /v1/tenants/:tenantId/licenses/:licenseId/revoke': 'license.revoked',
  'POST /v1/metrics/reset': 'metrics.reset',
  'POST /v1/mcp/servers': 'mcp_server.created',
  'PATCH /v1/mcp/servers/:serverId': 'mcp_server.updated',
  'DELETE /v1/mcp/servers/:serverId': 'mcp_server.deleted',
  'POST /v1/mcp/servers/:serverId/publish': 'mcp_server.published',
  'POST /v1/mcp/servers/:serverId/pause': 'mcp_server.paused',
  'POST /v1/mcp/servers/:serverId/resume': 'mcp_server.resumed',
  'POST /v1/mcp/servers/:serverId/versions/:version/restore': 'mcp_server.version_restored',
  'POST /v1/mcp/servers/:serverId/test': 'mcp_server.tested',
  'POST /v1/mcp/servers/:serverId/apis': 'mcp_api.added',
  'DELETE /v1/mcp/servers/:serverId/apis/:apiId': 'mcp_api.removed',
  'PATCH /v1/mcp/servers/:serverId/tools/:name': 'mcp_tool.updated',
  'POST /v1/mcp/approvals/:approvalId/approve': 'approval.approved',
  'POST /v1/mcp/approvals/:approvalId/refuse': 'approval.refused',
  'POST /v1/mcp/connectors': 'connector.created',
  'PATCH /v1/mcp/connectors/:connectorId': 'connector.updated',
  'DELETE /v1/mcp/connectors/:connectorId': 'connector.deleted',
  'PUT /v1/mcp/sign-in': 'mcp_sign_in.configured',
  'POST /v1/mcp/sign-in/check': 'mcp_sign_in.checked',
  'DELETE /v1/mcp/sign-in': 'mcp_sign_in.removed',
  'POST /v1/log-export/destinations': 'log_export.created',
  'PATCH /v1/log-export/destinations/:destinationId': 'log_export.updated',
  'DELETE /v1/log-export/destinations/:destinationId': 'log_export.deleted',
  'POST /v1/log-export/destinations/:destinationId/test': 'log_export.tested',
  'POST /v1/log-export/destinations/:destinationId/rotate-secret': 'log_export.secret_rotated',
  'POST /v1/log-export/dead-letters/:entryId/retry': 'log_export.dead_letter_retried',
  'DELETE /v1/log-export/dead-letters/:entryId': 'log_export.dead_letter_discarded',
  'POST /v1/enforcement/feeds': 'feed.created',
  'PATCH /v1/enforcement/feeds/:feedId': 'feed.updated',
  'POST /v1/enforcement/feeds/:feedId/rotate': 'feed.token_rotated',
  'DELETE /v1/enforcement/feeds/:feedId': 'feed.revoked',
  'PUT /v1/enforcement/aws': 'aws_lock.settings_saved',
  'POST /v1/enforcement/aws/generate': 'aws_lock.generated',
};

/** Traffic and machine routes: not admin activity (decisions and sign-ins cover them). */
const NOT_ADMIN = [/^\/v1\/enforcement\/feeds\/preview$/, /^\/v1\/chat\//, /^\/v1\/proxy\//, /^\/v1\/shadow-ai\/events/, /^\/v1\/reporting\//, /^\/v1\/ai\//,
  /^\/v1\/multimodal/, /^\/connector\//, /^\/mcp\//, /^\/oauth\//, /^\/public\//, /^\/health/, /^\/internal\//, /^\/\.well-known\//];

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** IDs worth keeping from a created record's response. Raw keys and secrets are never among them. */
const ID_FIELDS = ['feedId', 'keyId', 'policyId', 'ruleId', 'serverId', 'apiId', 'modelConfigId', 'connectorId', 'destinationId', 'licenseId', 'approvalId', 'version'];

export function actionFor(method: string, route: string): string | null {
  if (!MUTATING.has(method) || NOT_ADMIN.some((r) => r.test(route))) return null;
  const known = ADMIN_ACTIONS[`${method} ${route}`];
  if (known) return known;
  const area = route.replace(/^\/v1\//, '').split('/').find((p) => p && !p.startsWith(':')) ?? 'setting';
  return `${area.replace(/-/g, '_')}.changed`;
}

export function outcomeFor(status: number): ActivityOutcome | null {
  if (status < 400) return 'success';
  if (status === 401 || status === 403) return 'denied';
  if (status >= 500) return 'failure';
  return null; // a rejected form (400, 404, 409) changed nothing; not worth a record
}

export function actorOf(request: FastifyRequest): Actor | null {
  const p = request.principal;
  if (!p) return null;
  if (p.kind === 'user') return { type: 'user', id: p.userId, email: p.email, role: p.role };
  return { type: 'api_key', id: p.keyId, keyId: p.keyId };
}

/** IDs from a JSON response body (top level, or one level down in `data`, `key`, `server`…). */
export function idsFromBody(payload: unknown): Record<string, string> {
  if (typeof payload !== 'string' || payload.length > 200_000 || !payload.startsWith('{')) return {};
  let body: any;
  try { body = JSON.parse(payload); } catch { return {}; }
  const out: Record<string, string> = {};
  const take = (o: any) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return;
    for (const f of ID_FIELDS) if ((typeof o[f] === 'string' || typeof o[f] === 'number') && !out[f]) out[f] = String(o[f]).slice(0, 120);
  };
  take(body);
  for (const v of Object.values(body)) take(v);
  return out;
}

export function requestMeta(request: FastifyRequest) {
  const ua = request.headers['user-agent'];
  return {
    requestId: request.correlationId,
    sourceIp: request.ip,
    userAgent: Array.isArray(ua) ? ua[0] : ua,
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    activityIds?: Record<string, string>;
  }
}

export function createAdminActivityPlugin(log: () => ActivityLog = activityLog) {
  return fp(async function adminActivity(app: FastifyInstance) {
    app.addHook('onSend', async (request, reply, payload) => {
      const route = request.routeOptions?.url;
      if (route && reply.statusCode < 300 && actionFor(request.method, route)) request.activityIds = idsFromBody(payload);
      return payload;
    });

    app.addHook('onResponse', async (request, reply) => {
      const route = request.routeOptions?.url;
      if (!route) return;
      const action = actionFor(request.method, route);
      if (!action) return;
      const outcome = outcomeFor(reply.statusCode);
      const actor = actorOf(request);
      if (!outcome || !actor) return;
      const params = { ...((request.params ?? {}) as Record<string, string>) };
      // A platform admin acting on a tenant: the record belongs to that tenant, so they see it.
      const tenantId = params.tenantId || request.tenantId;
      if (!tenantId) return;
      delete params.tenantId;
      const input: ActivityInput = {
        tenantId,
        category: 'admin',
        action,
        outcome,
        actor,
        target: { ...params, ...(request.activityIds ?? {}) },
        ...requestMeta(request),
        detail: { status: reply.statusCode, ...(request.tenantId && request.tenantId !== tenantId ? { actingTenant: request.tenantId } : {}) },
      };
      void log().record(input);
    });
  });
}

export const adminActivity = createAdminActivityPlugin();
