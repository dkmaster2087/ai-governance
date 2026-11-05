import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { createLogger } from '@ai-governance/utils';
import { requireAccess, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { queryAuditLogs } from '../services/audit-query';
import { McpCredentialStore, hint } from '../mcp/credentials';
import { checkBaseUrl, EgressError } from '../mcp/egress';
import { OpenApiError, parseOpenApi } from '../mcp/openapi';
import { handleMessage, rpcError } from '../mcp/protocol';
import { mcpStore } from '../mcp/store';
import { ToolCaller } from '../mcp/calls';
import { BackendAuth, DEFAULT_LIMITS, McpApi, McpServer, McpTool } from '../mcp/types';

const logger = createLogger('gateway:mcp-routes');
const MAX_TOOLS_PER_API = 300;

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'server';

const serverInput = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).optional().default('') });
const serverChange = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  access: z.object({ allKeys: z.boolean(), keyIds: z.array(z.string().max(80)).max(200) }).optional(),
  limits: z.object({ callsPerMinute: z.number().int().min(1).max(10_000), maxResultBytes: z.number().int().min(1_000).max(1_000_000) }).optional(),
  returnPersonalData: z.boolean().optional(),
}).refine((c) => Object.keys(c).length > 0, 'Nothing to change');
const apiInput = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().min(8).max(500),
  openapi: z.string().min(2).max(5_000_000),
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
}).refine((c) => Object.keys(c).length > 0, 'Nothing to change');
const testInput = z.object({ tool: z.string().min(1).max(64), arguments: z.record(z.unknown()).optional().default({}) });

const bad = (reply: FastifyReply, code: string, error: string, status = 400) => reply.status(status).send({ error, code });

/** The address agents use. */
export const mcpPath = (s: Pick<McpServer, 'tenantId' | 'serverId'>) => `/mcp/${s.tenantId}/${s.serverId}`;

/** What the dashboard sees of an API: never the credential. */
const apiView = (a: McpApi) => ({ ...a, auth: a.auth.type === 'none' ? { type: 'none' } : { type: a.auth.type, ...(a.auth.type === 'header' ? { header: a.auth.header } : {}), hint: a.auth.hint } });

/** A simple per-instance limit: calls per minute per key per server. */
class MinuteLimiter {
  private windows = new Map<string, { minute: number; count: number }>();
  allow(key: string, limit: number): boolean {
    const minute = Math.floor(Date.now() / 60_000);
    const w = this.windows.get(key);
    if (!w || w.minute !== minute) { this.windows.set(key, { minute, count: 1 }); if (this.windows.size > 50_000) this.windows.clear(); return true; }
    return ++w.count <= limit;
  }
}

export async function mcpRoutes(app: FastifyInstance, opts: { caller?: ToolCaller; credentials?: McpCredentialStore } = {}) {
  const caller = opts.caller ?? new ToolCaller();
  const credentials = opts.credentials ?? new McpCredentialStore();
  const limiter = new MinuteLimiter();

  async function loadServer(request: FastifyRequest, reply: FastifyReply) {
    const { serverId } = request.params as { serverId: string };
    const server = await mcpStore.getServer(request.tenantId, serverId);
    if (!server) { bad(reply, 'NOT_FOUND', 'MCP server not found', 404); return null; }
    return server;
  }

  // ── Admin: servers ──────────────────────────────────────────────────────────────────────────

  app.get('/v1/mcp/servers', { preHandler: requireAccess(TENANT_READ) }, async (request) => {
    const servers = await mcpStore.listServers(request.tenantId);
    const to = new Date();
    const { logs } = await queryAuditLogs(request.tenantId, new Date(to.getTime() - 7 * 86_400_000).toISOString(), to.toISOString());
    const calls = logs.filter((l) => l.metadata?.kind === 'mcp_tool_call' && l.metadata.test !== 'true');
    return Promise.all(servers.map(async (s) => {
      const mine = calls.filter((l) => l.metadata.mcpServer === s.serverId);
      const tools = await mcpStore.listTools(request.tenantId, s.serverId);
      return {
        ...s, path: mcpPath(s), tools: tools.filter((t) => t.enabled).length,
        week: { calls: mine.length, stopped: mine.filter((l) => l.eventType === 'request_blocked').length },
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
        status: 'draft', access: { allKeys: true, keyIds: [] }, limits: { ...DEFAULT_LIMITS }, returnPersonalData: false,
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
    return mcpStore.updateServer(request.tenantId, server.serverId, parsed.data as Partial<McpServer>);
  });

  const setStatus = (status: 'published' | 'paused') => async (request: FastifyRequest, reply: FastifyReply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    if (status === 'published') {
      const tools = await mcpStore.listTools(request.tenantId, server.serverId);
      if (!tools.some((t) => t.enabled)) return bad(reply, 'NO_TOOLS', 'Turn on at least one tool before publishing');
    }
    const updated = await mcpStore.updateServer(request.tenantId, server.serverId, { status, ...(status === 'published' ? { publishedAt: new Date().toISOString() } : {}) });
    logger.info(`MCP server ${status}`, { tenantId: request.tenantId, serverId: server.serverId, by: request.userId });
    return { ...updated, path: mcpPath(server) };
  };
  app.post('/v1/mcp/servers/:serverId/publish', { preHandler: requireAccess(TENANT_ADMIN) }, setStatus('published'));
  app.post('/v1/mcp/servers/:serverId/pause', { preHandler: requireAccess(TENANT_ADMIN) }, setStatus('paused'));

  app.delete('/v1/mcp/servers/:serverId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    for (const a of await mcpStore.listApis(request.tenantId, server.serverId)) {
      if (a.auth.type !== 'none') await credentials.remove(a.auth.secretArn);
    }
    await mcpStore.deleteServer(request.tenantId, server.serverId);
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
    try { checkBaseUrl(body.baseUrl); } catch (err) { return bad(reply, (err as EgressError).code, (err as Error).message); }
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
        // Reads are on by default; writes are off until chosen (and can't be turned on yet).
        write: op.write, enabled: !op.write, createdAt: now,
      };
      await mcpStore.putTool(tool);
    }
    logger.info('MCP API added', { tenantId: request.tenantId, serverId: server.serverId, apiId, operations: spec.operations.length });
    return reply.status(201).send({ api: apiView(api), tools: spec.operations.length, reads: spec.operations.filter((o) => !o.write).length, skipped: spec.skipped });
  });

  app.delete('/v1/mcp/servers/:serverId/apis/:apiId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    const api = await mcpStore.getApi(request.tenantId, (request.params as { apiId: string }).apiId);
    if (!api || api.serverId !== server.serverId) return bad(reply, 'NOT_FOUND', 'API not found', 404);
    if (api.auth.type !== 'none') await credentials.remove(api.auth.secretArn);
    await mcpStore.deleteApi(request.tenantId, api);
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
    if (parsed.data.enabled && tool.write) {
      return bad(reply, 'WRITE_TOOLS_NOT_YET', 'Tools that change data (with approval where needed) come in the next release; only read tools can be turned on today', 409);
    }
    return mcpStore.updateTool(request.tenantId, server.serverId, name, parsed.data);
  });

  /** Try a tool from the dashboard, through every check, before anyone connects. Works on drafts. */
  app.post('/v1/mcp/servers/:serverId/test', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const server = await loadServer(request, reply);
    if (!server) return;
    const parsed = testInput.safeParse(request.body);
    if (!parsed.success) return bad(reply, 'INVALID_TEST', parsed.error.issues[0]?.message ?? 'Invalid test');
    const tool = await mcpStore.getTool(request.tenantId, server.serverId, parsed.data.tool);
    if (!tool) return bad(reply, 'NOT_FOUND', 'Tool not found', 404);
    const api = await mcpStore.getApi(request.tenantId, tool.apiId);
    if (!api) return bad(reply, 'NOT_FOUND', 'The tool\'s API was removed', 404);
    return caller.call(server, tool, api, parsed.data.arguments, { kind: 'test', id: request.userId, userId: request.userId, appId: 'dashboard-test' });
  });

  // ── The MCP address agents connect to ───────────────────────────────────────────────────────

  app.post('/mcp/:tenantId/:serverId', async (request, reply) => {
    const { tenantId, serverId } = request.params as { tenantId: string; serverId: string };
    const p = request.principal;
    // Browsers on other sites must not be able to drive an agent's session (MCP's DNS-rebinding rule).
    const origin = request.headers.origin;
    const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (origin && !allowedOrigins.includes(origin)) return bad(reply, 'ORIGIN_NOT_ALLOWED', 'Requests from browsers on other sites are refused', 403);
    if (!p || p.kind !== 'api_key' || !p.scopes.includes('mcp')) return bad(reply, 'FORBIDDEN', 'Use a Probaline API key with the mcp permission', 403);
    if (p.tenantId !== tenantId) return bad(reply, 'TENANT_MISMATCH', 'API key does not belong to this company', 403);
    const server = await mcpStore.getServer(tenantId, serverId);
    if (!server || server.status === 'draft') return bad(reply, 'NOT_FOUND', 'MCP server not found', 404);
    if (server.status === 'paused') return bad(reply, 'SERVER_PAUSED', `${server.name} is paused by your administrator`, 503);
    if (!server.access.allKeys && !server.access.keyIds.includes(p.keyId)) return bad(reply, 'FORBIDDEN', 'This API key may not use this MCP server', 403);
    if (!limiter.allow(`${tenantId}:${serverId}:${p.keyId}`, server.limits.callsPerMinute)) {
      return reply.status(429).header('retry-after', '60').send({ error: 'Too many calls; try again in a minute', code: 'RATE_LIMITED' });
    }

    const msg = request.body as any;
    if (Array.isArray(msg)) return reply.status(400).send(rpcError(null, -32600, 'Batches are not supported'));
    let tools: McpTool[] | undefined;
    const enabledTools = async () => (tools ??= (await mcpStore.listTools(tenantId, serverId)).filter((t) => t.enabled));
    const answer = await handleMessage(server, msg, {
      tools: enabledTools,
      call: async (tool, args) => {
        const api = await mcpStore.getApi(tenantId, tool.apiId);
        if (!api) return { requestId: '', isError: true, outcome: 'backend_error', checks: [], text: 'This tool\'s API was removed.' };
        return caller.call(server, tool, api, args, { kind: 'api_key', id: p.keyId, userId: p.userId, appId: p.appId });
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
