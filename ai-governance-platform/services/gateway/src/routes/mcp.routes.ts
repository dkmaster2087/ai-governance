import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { createLogger } from '@ai-governance/utils';
import { requireAccess, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { AnalyticsClient, analyticsClient } from '../clients/analytics.client';
import { tenantSettings } from '../services/tenant-settings.service';
import { connectRefusal, toolsFor } from '../mcp/access';
import { publicBase } from '../mcp/base';
import { Caller, ToolCaller } from '../mcp/calls';
import { connectorService, ConnectorService, hostAllowed } from '../mcp/connectors';
import { McpCredentialStore, hint } from '../mcp/credentials';
import { checkBaseUrl, EgressError } from '../mcp/egress';
import { OpenApiError, parseOpenApi } from '../mcp/openapi';
import { handleMessage, rpcError } from '../mcp/protocol';
import { mcpStore } from '../mcp/store';
import { gatewayKeys } from '../mcp/keys';
import { forgetUpstreamSession, UpstreamError, UpstreamMcp, UpstreamTool } from '../mcp/upstream';
import { BackendAuth, DEFAULT_ACCESS, DEFAULT_APPROVALS, DEFAULT_LIMITS, McpApi, McpServer, McpTool, withDefaults } from '../mcp/types';
import { credentialsInUse, liveConfig, publishVersion, restoreVersion } from '../mcp/versions';
import { personFromToken } from './mcp-oauth.routes';
import { licenseState } from '../services/license-state';
import { licenseEnded } from '../middleware/auth.middleware';
import { rateCounter } from '../services/rate-counter';

const logger = createLogger('gateway:mcp-routes');
const MAX_TOOLS_PER_API = 300;

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'server';
const group = z.string().trim().min(1).max(200);
const email = z.string().trim().toLowerCase().email().max(200);

const serverInput = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).optional().default('') });
const serverChange = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  access: z.object({
    allKeys: z.boolean(), keyIds: z.array(z.string().max(80)).max(200),
    people: z.enum(['none', 'all', 'groups']).optional(), groups: z.array(group).max(100).optional(),
  }).optional(),
  limits: z.object({ callsPerMinute: z.number().int().min(1).max(10_000), maxResultBytes: z.number().int().min(1_000).max(1_000_000), callsPerDay: z.number().int().min(0).max(1_000_000).optional() }).optional(),
  returnPersonalData: z.boolean().optional(),
  argumentChecks: z.enum(['block', 'flag', 'off']).optional(),
  approvals: z.object({
    approvers: z.array(email).max(50), waitSeconds: z.number().int().min(0).max(110), expiresMinutes: z.number().int().min(5).max(7 * 24 * 60),
    webhookUrl: z.string().trim().url().max(500).or(z.literal('')).optional(),
  }).optional(),
}).refine((c) => Object.keys(c).length > 0, 'Nothing to change');
const authInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer'), secret: z.string().min(1).max(4000) }),
  z.object({ type: z.literal('header'), header: z.string().regex(/^[A-Za-z0-9-]{1,60}$/), secret: z.string().min(1).max(4000) }),
]);
/** A company's existing MCP server (Streamable HTTP), put behind this Probaline MCP server. */
const upstreamInput = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(8).max(500),
  connectorId: z.string().regex(/^con_[a-f0-9]+$/).optional(),
  auth: authInput,
});
const apiInput = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().min(8).max(500),
  openapi: z.string().min(2).max(5_000_000),
  connectorId: z.string().regex(/^con_[a-f0-9]+$/).optional(),
  auth: z.discriminatedUnion('type', [
    z.object({ type: z.literal('none') }),
    z.object({ type: z.literal('bearer'), secret: z.string().min(1).max(4000) }),
    z.object({ type: z.literal('header'), header: z.string().regex(/^[A-Za-z0-9-]{1,60}$/), secret: z.string().min(1).max(4000) }),
  ]),
});
const toolChange = z.object({
  enabled: z.boolean().optional(),
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  approval: z.enum(['required', 'none']).optional(),
  groups: z.array(group).max(50).optional(),
  callsPerMinute: z.number().int().min(1).max(10_000).nullable().optional(),
}).refine((c) => Object.keys(c).length > 0, 'Nothing to change');
const testInput = z.object({ tool: z.string().min(1).max(64), arguments: z.record(z.unknown()).optional().default({}) });
const publishInput = z.object({ note: z.string().trim().max(200).optional().default('') });

const bad = (reply: FastifyReply, code: string, error: string, status = 400) => reply.status(status).send({ error, code });

/** The address agents use. */
export const mcpPath = (s: Pick<McpServer, 'tenantId' | 'serverId'>) => `/mcp/${s.tenantId}/${s.serverId}`;

/** What the dashboard sees of an API: never the credential. */
const apiView = (a: McpApi) => ({ ...a, auth: a.auth.type === 'none' ? { type: 'none' } : { type: a.auth.type, ...(a.auth.type === 'header' ? { header: a.auth.header } : {}), hint: a.auth.hint } });

export async function mcpRoutes(app: FastifyInstance, opts: { caller?: ToolCaller; credentials?: McpCredentialStore; connectors?: ConnectorService } = {}) {
  const caller = opts.caller ?? new ToolCaller();
  const credentials = opts.credentials ?? new McpCredentialStore();
  const connectors = () => opts.connectors ?? connectorService();

  async function loadServer(request: FastifyRequest, reply: FastifyReply) {
    const { serverId } = request.params as { serverId: string };
    const server = await mcpStore.getServer(request.tenantId, serverId);
    if (!server) { bad(reply, 'NOT_FOUND', 'MCP server not found', 404); return null; }
    return withDefaults(server);
  }
  /** Any change to the draft of a published server is waiting to be published. */
  const changed = (s: McpServer) => (s.publishedVersion ? mcpStore.updateServer(s.tenantId, s.serverId, { hasChanges: true }) : Promise.resolve(null));

  // ── Admin: servers ──────────────────────────────────────────────────────────────────────────

  app.get('/v1/mcp/servers', { preHandler: requireAccess(TENANT_READ) }, async (request) => {
    // This week's calls come from analytics; the list still loads without them.
    const [servers, activity] = await Promise.all([
      mcpStore.listServers(request.tenantId),
      analyticsClient().optional<{ servers: Record<string, { calls: number; stopped: number }> }>('/internal/v1/mcp/activity', AnalyticsClient.callerOf(request)),
    ]);
    return Promise.all(servers.map(async (raw) => {
      const s = withDefaults(raw);
      const tools = await mcpStore.listTools(request.tenantId, s.serverId);
      return {
        ...s, path: mcpPath(s), tools: tools.filter((t) => t.enabled).length,
        week: activity ? (activity.servers[s.serverId] ?? { calls: 0, stopped: 0 }) : null,
      };
    }));
  });

  app.post('/v1/mcp/servers', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = serverInput.safeParse(request.body);
    if (!parsed.success) return bad(reply, 'INVALID_SERVER', parsed.error.issues[0]?.message ?? 'Invalid server');
    const now = new Date().toISOString();
    const base = slug(parsed.data.name);
    for (let i = 1; i <= 50; i++) {
      const server: McpServer = {
        tenantId: request.tenantId, serverId: i === 1 ? base : `${base}-${i}`, name: parsed.data.name, description: parsed.data.description,
        status: 'draft', access: { ...DEFAULT_ACCESS }, limits: { ...DEFAULT_LIMITS }, returnPersonalData: false, argumentChecks: 'block', approvals: { ...DEFAULT_APPROVALS },
        createdAt: now, updatedAt: now, createdBy: request.userId,
      };
      if (await mcpStore.createServer(server)) {
        logger.info('MCP server created', { tenantId: request.tenantId, serverId: server.serverId, by: request.userId });
        return reply.status(201).send({ ...server, path: mcpPath(server) });
      }
    }
    return bad(reply, 'NAME_TAKEN', 'Choose a different name', 409);
  });

  app.get('/v1/mcp/servers/:serverId', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    const [apis, tools] = await Promise.all([mcpStore.listApis(request.tenantId, server.serverId), mcpStore.listTools(request.tenantId, server.serverId)]);
    return { ...server, path: mcpPath(server), apis: apis.map(apiView), tools };
  });

  app.patch('/v1/mcp/servers/:serverId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    const parsed = serverChange.safeParse(request.body);
    if (!parsed.success) return bad(reply, 'INVALID_SERVER', parsed.error.issues[0]?.message ?? 'Invalid change');
    const change = parsed.data;
    const set: Partial<McpServer> = { ...change } as Partial<McpServer>;
    if (change.access) set.access = { ...server.access, ...change.access, groups: [...new Set(change.access.groups ?? server.access.groups)] };
    if (change.approvals) {
      if (change.approvals.webhookUrl) {
        try { checkBaseUrl(change.approvals.webhookUrl); } catch (err) { return bad(reply, 'INVALID_SERVER', `Webhook: ${(err as Error).message}`); }
      }
      set.approvals = { ...change.approvals, approvers: [...new Set(change.approvals.approvers)], webhookUrl: change.approvals.webhookUrl || undefined };
    }
    return mcpStore.updateServer(request.tenantId, server.serverId, { ...set, ...(server.publishedVersion ? { hasChanges: true } : {}) });
  });

  /** Publish the draft as a new version: agents see it all at once. */
  app.post('/v1/mcp/servers/:serverId/publish', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    const parsed = publishInput.safeParse(request.body ?? {});
    if (!parsed.success) return bad(reply, 'INVALID_PUBLISH', 'Invalid note');
    const tools = await mcpStore.listTools(request.tenantId, server.serverId);
    if (!tools.some((t) => t.enabled)) return bad(reply, 'NO_TOOLS', 'Turn on at least one tool before publishing');
    const v = await publishVersion(server, request.userId, parsed.data.note);
    logger.info('MCP server published', { tenantId: request.tenantId, serverId: server.serverId, version: v.version, by: request.userId });
    return { ...(await mcpStore.getServer(request.tenantId, server.serverId)), path: mcpPath(server), version: v.version };
  });

  app.post('/v1/mcp/servers/:serverId/pause', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    if (server.status === 'draft') return bad(reply, 'NOT_PUBLISHED', 'Only a published server can be paused');
    logger.info('MCP server paused', { tenantId: request.tenantId, serverId: server.serverId, by: request.userId });
    return { ...(await mcpStore.updateServer(request.tenantId, server.serverId, { status: 'paused' })), path: mcpPath(server) };
  });

  app.post('/v1/mcp/servers/:serverId/resume', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    if (server.status !== 'paused') return bad(reply, 'NOT_PAUSED', 'The server isn\'t paused');
    logger.info('MCP server resumed', { tenantId: request.tenantId, serverId: server.serverId, by: request.userId });
    return { ...(await mcpStore.updateServer(request.tenantId, server.serverId, { status: 'published' })), path: mcpPath(server) };
  });

  app.get('/v1/mcp/servers/:serverId/versions', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    return (await mcpStore.listVersions(request.tenantId, server.serverId)).map((v) => ({
      version: v.version, note: v.note, publishedAt: v.publishedAt, publishedBy: v.publishedBy, tools: v.toolCount, apis: v.apis.length, live: v.version === server.publishedVersion,
    }));
  });

  app.post('/v1/mcp/servers/:serverId/versions/:version/restore', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    const n = Number((request.params as { version: string }).version);
    if (!Number.isInteger(n) || n < 1 || !(await restoreVersion(server, n))) return bad(reply, 'NOT_FOUND', 'Version not found', 404);
    logger.info('MCP server version restored to draft', { tenantId: request.tenantId, serverId: server.serverId, version: n, by: request.userId });
    return { ok: true, restored: n };
  });

  app.delete('/v1/mcp/servers/:serverId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    const arns = await credentialsInUse(server);
    await mcpStore.deleteServer(request.tenantId, server.serverId);
    for (const arn of arns) await credentials.remove(arn);
    logger.info('MCP server deleted', { tenantId: request.tenantId, serverId: server.serverId, by: request.userId });
    return { ok: true };
  });

  // ── Admin: APIs and tools ───────────────────────────────────────────────────────────────────

  app.post('/v1/mcp/servers/:serverId/apis', { preHandler: requireAccess(TENANT_ADMIN), bodyLimit: 6_000_000 }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    const parsed = apiInput.safeParse(request.body);
    if (!parsed.success) return bad(reply, 'INVALID_API', parsed.error.issues[0]?.message ?? 'Invalid API');
    const body = parsed.data;
    if (body.connectorId) {
      // Reached inside the company's network: any address the connector is allowed to call.
      const c = await connectors().get(request.tenantId, body.connectorId);
      if (!c) return bad(reply, 'NOT_FOUND', 'Connector not found', 404);
      let u: URL;
      try { u = new URL(body.baseUrl); } catch { return bad(reply, 'INVALID_BASE_URL', 'The base URL isn\'t a valid URL'); }
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) return bad(reply, 'INVALID_BASE_URL', 'Use an http or https address without credentials, query or fragment');
      if (!hostAllowed(c, u)) return bad(reply, 'CONNECTOR_HOST_NOT_ALLOWED', `The connector ${c.name} isn't allowed to call ${u.host}. Add it to the connector's allowed hosts first.`);
    } else {
      try { checkBaseUrl(body.baseUrl); } catch (err) { return bad(reply, (err as EgressError).code, (err as Error).message); }
    }
    let spec;
    try { spec = parseOpenApi(body.openapi); } catch (err) {
      if (err instanceof OpenApiError) return bad(reply, err.code, err.message);
      throw err;
    }
    if (spec.operations.length > MAX_TOOLS_PER_API) return bad(reply, 'TOO_MANY_OPERATIONS', `The API has ${spec.operations.length} operations; at most ${MAX_TOOLS_PER_API} are supported per API`);

    const apiId = `api_${randomBytes(6).toString('hex')}`;
    let auth: BackendAuth = { type: 'none' };
    if (body.auth.type !== 'none') {
      const secretArn = await credentials.save(request.tenantId, apiId, body.auth.secret);
      auth = body.auth.type === 'bearer' ? { type: 'bearer', secretArn, hint: hint(body.auth.secret) } : { type: 'header', header: body.auth.header, secretArn, hint: hint(body.auth.secret) };
    }
    const now = new Date().toISOString();
    const api: McpApi = {
      tenantId: request.tenantId, apiId, serverId: server.serverId, name: body.name, baseUrl: body.baseUrl.replace(/\/$/, ''), auth,
      ...(body.connectorId ? { connectorId: body.connectorId } : {}),
      openapi: { title: spec.title, version: spec.version, operations: spec.operations.length, skipped: spec.skipped.slice(0, 50) }, createdAt: now,
    };
    await mcpStore.putApi(api);
    // Tool names must be unique on a server: if another API already has the name, prefix this API's.
    const taken = new Set((await mcpStore.listTools(request.tenantId, server.serverId)).map((t) => t.name));
    const prefix = slug(body.name).replace(/-/g, '_').slice(0, 20);
    for (const op of spec.operations) {
      const name = taken.has(op.name) ? `${prefix}_${op.name}`.slice(0, 64) : op.name;
      taken.add(name);
      const tool: McpTool = {
        tenantId: request.tenantId, toolKey: `${server.serverId}#${name}`, serverId: server.serverId, apiId, name,
        title: op.title, description: op.description, inputSchema: op.inputSchema, method: op.method, path: op.path, params: op.params,
        // Reads are on by default; writes are off until chosen, and then need approval unless the admin says otherwise.
        write: op.write, enabled: !op.write, ...(op.write ? { approval: 'required' as const } : {}), createdAt: now,
      };
      await mcpStore.putTool(tool);
    }
    await changed(server);
    logger.info('MCP API added', { tenantId: request.tenantId, serverId: server.serverId, apiId, operations: spec.operations.length, connector: body.connectorId });
    return reply.status(201).send({ api: apiView(api), tools: spec.operations.length, reads: spec.operations.filter((o) => !o.write).length, skipped: spec.skipped });
  });

  /** Where a backend is reached: through a connector (any host it may call) or directly (public https only). */
  async function checkTarget(request: FastifyRequest, reply: FastifyReply, address: string, connectorId?: string, what = 'base URL'): Promise<boolean> {
    if (connectorId) {
      const c = await connectors().get(request.tenantId, connectorId);
      if (!c) { bad(reply, 'NOT_FOUND', 'Connector not found', 404); return false; }
      let u: URL;
      try { u = new URL(address); } catch { bad(reply, 'INVALID_BASE_URL', `The ${what} isn't a valid URL`); return false; }
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.hash) { bad(reply, 'INVALID_BASE_URL', 'Use an http or https address without credentials or fragment'); return false; }
      if (!hostAllowed(c, u)) { bad(reply, 'CONNECTOR_HOST_NOT_ALLOWED', `The connector ${c.name} isn't allowed to call ${u.host}. Add it to the connector's allowed hosts first.`); return false; }
      return true;
    }
    try { checkBaseUrl(address); } catch (err) { bad(reply, (err as EgressError).code, (err as Error).message); return false; }
    return true;
  }

  /** Ask a company MCP server for its tools, as Probaline (signed: an admin adding or refreshing it). */
  async function upstreamTools(request: FastifyRequest, server: McpServer, api: McpApi, secret?: string): Promise<UpstreamTool[]> {
    const now = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = {
      'user-agent': 'Probaline-MCP/1.0',
      'x-probaline-identity': await gatewayKeys().sign({
        iss: publicBase(), aud: api.baseUrl, sub: `admin:${request.userId}`, iat: now, exp: now + 300, jti: randomBytes(8).toString('hex'),
        kind: 'admin', tenant: request.tenantId, server: server.serverId, tool: 'tools/list',
      }, 'probaline-identity+jwt'),
    };
    if (secret && api.auth.type === 'bearer') headers.authorization = `Bearer ${secret}`;
    if (secret && api.auth.type === 'header') headers[api.auth.header.toLowerCase()] = secret;
    forgetUpstreamSession(`${request.tenantId}#${api.apiId}`);
    const upstream = new UpstreamMcp(`${request.tenantId}#${api.apiId}`, (b, h) => caller.sendUpstream(request.tenantId, api, b, h, 2_000_000), headers);
    return upstream.listTools(MAX_TOOLS_PER_API);
  }

  const toolName = (n: string) => n.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'tool';

  /** Put a company MCP server's tools on this server: reads on, anything not marked read-only off and needing approval. */
  async function saveUpstreamTools(server: McpServer, api: McpApi, found: UpstreamTool[]) {
    const existing = await mcpStore.listTools(server.tenantId, server.serverId);
    const mine = new Map(existing.filter((t) => t.apiId === api.apiId).map((t) => [t.upstreamName ?? t.name, t]));
    const taken = new Set(existing.filter((t) => t.apiId !== api.apiId).map((t) => t.name));
    const prefix = slug(api.name).replace(/-/g, '_').slice(0, 20);
    const now = new Date().toISOString();
    let added = 0; let updated = 0;
    for (const t of found) {
      const before = mine.get(t.name);
      mine.delete(t.name);
      if (before) {
        // The company server changed a tool: take its new description and schema. A tool that now changes data is
        // switched off until an admin looks at it again.
        const nowWrite = t.write && !before.write;
        await mcpStore.updateTool(server.tenantId, server.serverId, before.name, {
          title: t.title, description: t.description, inputSchema: t.inputSchema, write: t.write,
          ...(nowWrite ? { enabled: false, approval: 'required' as const } : {}),
        });
        updated++;
        continue;
      }
      const base = toolName(t.name);
      const name = taken.has(base) ? toolName(`${prefix}_${base}`) : base;
      taken.add(name);
      await mcpStore.putTool({
        tenantId: server.tenantId, toolKey: `${server.serverId}#${name}`, serverId: server.serverId, apiId: api.apiId, name, upstreamName: t.name,
        title: t.title, description: t.description, inputSchema: t.inputSchema, method: 'POST', path: '', params: { path: [], query: [], body: false },
        write: t.write, enabled: !t.write, ...(t.write ? { approval: 'required' as const } : {}), createdAt: now,
      });
      added++;
    }
    // Tools the company server no longer has.
    for (const gone of mine.values()) await mcpStore.deleteTool(server.tenantId, gone.toolKey);
    return { added, updated, removed: mine.size };
  }

  app.post('/v1/mcp/servers/:serverId/upstreams', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    const parsed = upstreamInput.safeParse(request.body);
    if (!parsed.success) return bad(reply, 'INVALID_API', parsed.error.issues[0]?.message ?? 'Invalid MCP server');
    const body = parsed.data;
    if (!(await checkTarget(request, reply, body.url, body.connectorId, 'address'))) return;
    const apiId = `api_${randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const pending: McpApi = {
      tenantId: request.tenantId, apiId, serverId: server.serverId, name: body.name, kind: 'mcp', baseUrl: body.url, createdAt: now,
      auth: body.auth.type === 'none' ? { type: 'none' } : body.auth.type === 'bearer' ? { type: 'bearer' } : { type: 'header', header: body.auth.header },
      ...(body.connectorId ? { connectorId: body.connectorId } : {}),
      openapi: { title: body.name, version: '', operations: 0, skipped: [] },
    };
    // Connect first: nothing is saved for a server that can't be reached or refuses Probaline.
    let found: UpstreamTool[];
    try {
      found = await upstreamTools(request, server, pending, body.auth.type === 'none' ? undefined : body.auth.secret);
    } catch (err) {
      const message = err instanceof UpstreamError || err instanceof EgressError ? err.message : 'The MCP server couldn\'t be reached';
      return bad(reply, err instanceof UpstreamError ? err.code : 'UPSTREAM_UNREACHABLE', message, 502);
    }
    if (!found.length) return bad(reply, 'NO_TOOLS', 'The MCP server has no tools to offer', 422);
    let auth: BackendAuth = { type: 'none' };
    if (body.auth.type !== 'none') {
      const secretArn = await credentials.save(request.tenantId, apiId, body.auth.secret);
      auth = body.auth.type === 'bearer' ? { type: 'bearer', secretArn, hint: hint(body.auth.secret) } : { type: 'header', header: body.auth.header, secretArn, hint: hint(body.auth.secret) };
    }
    const api: McpApi = { ...pending, auth, openapi: { title: body.name, version: '', operations: found.length, skipped: [] } };
    await mcpStore.putApi(api);
    const counts = await saveUpstreamTools(server, api, found);
    await changed(server);
    logger.info('Company MCP server added', { tenantId: request.tenantId, serverId: server.serverId, apiId, tools: found.length, connector: body.connectorId });
    return reply.status(201).send({ api: apiView(api), tools: found.length, reads: found.filter((t) => !t.write).length, ...counts });
  });

  /** Read a company MCP server's tools again: new ones are added, changed ones updated, removed ones dropped. */
  app.post('/v1/mcp/servers/:serverId/apis/:apiId/refresh', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    const api = await mcpStore.getApi(request.tenantId, (request.params as { apiId: string }).apiId);
    if (!api || api.serverId !== server.serverId) return bad(reply, 'NOT_FOUND', 'API not found', 404);
    if (api.kind !== 'mcp') return bad(reply, 'NOT_MCP', 'Only a company MCP server’s tools can be read again; for an OpenAPI API, add it again');
    let found: UpstreamTool[];
    try {
      const secret = api.auth.type !== 'none' && api.auth.secretArn ? await credentials.get(api.auth.secretArn) : undefined;
      found = await upstreamTools(request, server, api, secret);
    } catch (err) {
      const message = err instanceof UpstreamError || err instanceof EgressError ? err.message : 'The MCP server couldn\'t be reached';
      return bad(reply, err instanceof UpstreamError ? err.code : 'UPSTREAM_UNREACHABLE', message, 502);
    }
    const counts = await saveUpstreamTools(server, api, found);
    await mcpStore.putApi({ ...api, openapi: { ...api.openapi, operations: found.length } });
    await changed(server);
    return { tools: found.length, ...counts };
  });

  app.delete('/v1/mcp/servers/:serverId/apis/:apiId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    const api = await mcpStore.getApi(request.tenantId, (request.params as { apiId: string }).apiId);
    if (!api || api.serverId !== server.serverId) return bad(reply, 'NOT_FOUND', 'API not found', 404);
    // The credential stays while a published version may still use it; it goes with the server.
    await mcpStore.deleteApi(request.tenantId, api);
    if (!server.publishedVersion && api.auth.type !== 'none') await credentials.remove(api.auth.secretArn);
    await changed(server);
    return { ok: true };
  });

  app.patch('/v1/mcp/servers/:serverId/tools/:name', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    const { name } = request.params as { name: string };
    const tool = await mcpStore.getTool(request.tenantId, server.serverId, name);
    if (!tool) return bad(reply, 'NOT_FOUND', 'Tool not found', 404);
    const parsed = toolChange.safeParse(request.body);
    if (!parsed.success) return bad(reply, 'INVALID_TOOL', parsed.error.issues[0]?.message ?? 'Invalid change');
    if (parsed.data.approval && !tool.write) return bad(reply, 'INVALID_TOOL', 'Only tools that change data need approval');
    const { callsPerMinute, ...rest } = parsed.data;
    const set: Partial<McpTool> = {
      ...rest, ...(parsed.data.groups ? { groups: [...new Set(parsed.data.groups)] } : {}),
      // null clears the tool's own limit.
      ...(callsPerMinute !== undefined ? { callsPerMinute: callsPerMinute ?? undefined } : {}),
    };
    // A write switched on without a choice needs approval.
    if (tool.write && parsed.data.enabled && !tool.approval && !parsed.data.approval) set.approval = 'required';
    const updated = await mcpStore.updateTool(request.tenantId, server.serverId, name, set);
    await changed(server);
    return updated;
  });

  /** Try a tool from the dashboard, through every check, before anyone connects. Works on the draft. */
  app.post('/v1/mcp/servers/:serverId/test', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    const parsed = testInput.safeParse(request.body);
    if (!parsed.success) return bad(reply, 'INVALID_TEST', parsed.error.issues[0]?.message ?? 'Invalid test');
    const tool = await mcpStore.getTool(request.tenantId, server.serverId, parsed.data.tool);
    if (!tool) return bad(reply, 'NOT_FOUND', 'Tool not found', 404);
    const api = await mcpStore.getApi(request.tenantId, tool.apiId);
    if (!api) return bad(reply, 'NOT_FOUND', 'The tool\'s API was removed', 404);
    const p = request.principal;
    const email = p?.kind === 'user' ? p.email : undefined;
    // Tests don't wait for approval: the console shows the request, and running it again uses the decision.
    return caller.call({ ...server, approvals: { ...server.approvals, waitSeconds: 0 } }, tool, api, parsed.data.arguments,
      { kind: 'test', id: `test:${request.userId}`, userId: request.userId, email, appId: 'dashboard-test' });
  });

  // ── The MCP address agents connect to ───────────────────────────────────────────────────────

  app.post('/mcp/:tenantId/:serverId', async (request, reply) => {
    const { tenantId, serverId } = request.params as { tenantId: string; serverId: string };
    const base = publicBase(request);
    // Browsers on other sites must not be able to drive an agent's session (MCP's DNS-rebinding rule).
    const origin = request.headers.origin;
    const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (origin && !allowedOrigins.includes(origin)) return bad(reply, 'ORIGIN_NOT_ALLOWED', 'Requests from browsers on other sites are refused', 403);

    // Who: a person signed in through the company's identity provider, or a workload with an API key.
    const p = request.principal;
    let who: Caller | null = null;
    const auth = String(request.headers.authorization ?? '');
    if (p?.kind === 'api_key') {
      if (!p.scopes.includes('mcp')) return bad(reply, 'FORBIDDEN', 'Use a Probaline API key with the mcp permission', 403);
      if (p.tenantId !== tenantId) return bad(reply, 'TENANT_MISMATCH', 'API key does not belong to this company', 403);
      who = { kind: 'api_key', id: p.keyId, userId: p.userId, appId: p.appId };
    } else if (!p && auth.startsWith('Bearer ')) {
      who = await personFromToken(auth.slice(7).trim(), base, tenantId, serverId);
      if (who && (await tenantSettings().getStatus(tenantId)) === 'suspended') return bad(reply, 'TENANT_SUSPENDED', 'This tenant is suspended', 403);
      const license = who ? await licenseState().get(tenantId) : null;
      if (license?.state === 'lapsed') return reply.status(403).send(licenseEnded(license));
    } else if (p) {
      return bad(reply, 'FORBIDDEN', 'Use a Probaline API key with the mcp permission, or sign in', 403);
    }
    if (!who) {
      // Tell the client where to sign in (OAuth protected-resource metadata).
      return reply.status(401)
        .header('www-authenticate', `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp/${tenantId}/${serverId}"${auth ? ', error="invalid_token"' : ''}`)
        .send({ error: 'Sign in, or use a Probaline API key with the mcp permission', code: auth ? 'INVALID_TOKEN' : 'MISSING_AUTH' });
    }

    const raw = await mcpStore.getServer(tenantId, serverId);
    if (!raw || raw.status === 'draft') return bad(reply, 'NOT_FOUND', 'MCP server not found', 404);
    const server = withDefaults(raw);
    if (server.status === 'paused') return bad(reply, 'SERVER_PAUSED', `${server.name} is paused by your administrator`, 503);
    const live = await liveConfig(server);
    const refusal = connectRefusal(live.config, who);
    if (refusal) return bad(reply, 'FORBIDDEN', refusal, 403);
    const rate = await rateCounter().hit(tenantId, `mcp#${serverId}#${who.id}`, live.config.limits.callsPerMinute);
    if (!rate.allowed) {
      return reply.status(429).header('retry-after', String(rate.retryAfter)).send({ error: `Too many calls; try again in ${rate.retryAfter} seconds`, code: 'RATE_LIMITED' });
    }

    const msg = request.body as any;
    if (Array.isArray(msg)) return reply.status(400).send(rpcError(null, -32600, 'Batches are not supported'));
    const ref = { ...live.config, tenantId, serverId };
    const caller_ = who;
    const answer = await handleMessage(ref, msg, {
      tools: async () => toolsFor(live.tools, caller_),
      call: async (tool, args) => {
        const api = live.apis.find((a) => a.apiId === tool.apiId);
        if (!api) return { requestId: '', isError: true, outcome: 'backend_error', checks: [], text: 'This tool\'s API was removed.' };
        return caller.call(ref, tool, api, args, caller_);
      },
    });
    if (answer === null) return reply.status(202).send();
    return reply.header('content-type', 'application/json').send(answer);
  });

  // This server answers each message directly and doesn't open event streams or keep sessions.
  const notAllowed = async (_req: FastifyRequest, reply: FastifyReply) => reply.status(405).header('allow', 'POST').send({ error: 'Use POST', code: 'METHOD_NOT_ALLOWED' });
  app.get('/mcp/:tenantId/:serverId', notAllowed);
  app.delete('/mcp/:tenantId/:serverId', notAllowed);
}
