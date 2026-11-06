import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createLogger } from '@ai-governance/utils';
import { requireAccess, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { Connector, ConnectorService, connectorService, HOST_PATTERN, isOnline } from '../mcp/connectors';
import { mcpStore } from '../mcp/store';

const logger = createLogger('gateway:mcp-connectors');

const hosts = z.array(z.string().trim().toLowerCase().regex(HOST_PATTERN, 'Each allowed host is a name like hr.corp.example, hr.corp.example:8443 or *.corp.example')).min(1).max(50);
const connectorInput = z.object({ name: z.string().trim().min(1).max(80), allowedHosts: hosts });
const connectorChange = z.object({ name: z.string().trim().min(1).max(80).optional(), allowedHosts: hosts.optional() });
const answerInput = z.object({
  id: z.string().regex(/^[a-f0-9]{16}$/),
  answer: z.object({ status: z.number().int().min(100).max(599), contentType: z.string().max(200), body: z.string().max(400_000), truncated: z.boolean(), ms: z.number().min(0) }).optional(),
  error: z.object({ code: z.string().max(40), message: z.string().max(300) }).optional(),
});

const view = (c: Connector, apis: number) => ({
  connectorId: c.connectorId, name: c.name, allowedHosts: c.allowedHosts, tokenHint: c.tokenHint, createdAt: c.createdAt,
  lastSeenAt: c.lastSeenAt, agentVersion: c.agentVersion, online: isOnline(c), apis,
});

export async function mcpConnectorRoutes(app: FastifyInstance, opts: { connectors?: ConnectorService; waitMs?: number } = {}) {
  const connectors = () => opts.connectors ?? connectorService();
  const usage = async (tenantId: string) => {
    const counts = new Map<string, number>();
    for (const a of await mcpStore.listAllApis(tenantId)) if (a.connectorId) counts.set(a.connectorId, (counts.get(a.connectorId) ?? 0) + 1);
    return counts;
  };

  // ── Admin ──────────────────────────────────────────────────────────────────────────────────────

  app.get('/v1/mcp/connectors', { preHandler: requireAccess(TENANT_READ) }, async (request) => {
    const [list, counts] = await Promise.all([connectors().list(request.tenantId), usage(request.tenantId)]);
    return list.map((c) => view(c, counts.get(c.connectorId) ?? 0));
  });

  app.post('/v1/mcp/connectors', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = connectorInput.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid connector', code: 'INVALID_CONNECTOR' });
    const { connector, token } = await connectors().create(request.tenantId, parsed.data.name, [...new Set(parsed.data.allowedHosts)], request.userId);
    logger.info('Connector created', { tenantId: request.tenantId, connectorId: connector.connectorId, by: request.userId });
    // The token is shown once.
    return reply.status(201).send({ ...view(connector, 0), token });
  });

  app.patch('/v1/mcp/connectors/:connectorId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = connectorChange.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid change', code: 'INVALID_CONNECTOR' });
    const updated = await connectors().update(request.tenantId, (request.params as { connectorId: string }).connectorId, parsed.data);
    if (!updated) return reply.status(404).send({ error: 'Connector not found', code: 'NOT_FOUND' });
    return view(updated, (await usage(request.tenantId)).get(updated.connectorId) ?? 0);
  });

  app.delete('/v1/mcp/connectors/:connectorId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { connectorId } = request.params as { connectorId: string };
    const inUse = (await usage(request.tenantId)).get(connectorId) ?? 0;
    if (inUse) return reply.status(409).send({ error: `${inUse} API${inUse === 1 ? ' uses' : 's use'} this connector; remove ${inUse === 1 ? 'it' : 'them'} first`, code: 'CONNECTOR_IN_USE' });
    await connectors().remove(request.tenantId, connectorId);
    return { ok: true };
  });

  // ── The connector itself (authenticated by its token) ──────────────────────────────────────────

  async function connectorFrom(request: FastifyRequest) {
    const h = request.headers.authorization ?? '';
    return h.startsWith('Bearer ') ? connectors().authenticate(h.slice(7).trim()) : null;
  }

  app.post('/connector/v1/poll', async (request, reply) => {
    const c = await connectorFrom(request);
    if (!c) return reply.status(401).send({ error: 'Unknown connector token', code: 'INVALID_CONNECTOR_TOKEN' });
    const body = (request.body ?? {}) as { version?: string };
    const jobs = await connectors().take(c, opts.waitMs ?? 20_000, 5, typeof body.version === 'string' ? body.version : undefined);
    return { jobs, allowedHosts: c.allowedHosts };
  });

  app.post('/connector/v1/answer', { bodyLimit: 600_000 }, async (request, reply) => {
    const c = await connectorFrom(request);
    if (!c) return reply.status(401).send({ error: 'Unknown connector token', code: 'INVALID_CONNECTOR_TOKEN' });
    const parsed = answerInput.safeParse(request.body);
    if (!parsed.success || (!parsed.data.answer && !parsed.data.error)) return reply.status(400).send({ error: 'Invalid answer', code: 'INVALID_ANSWER' });
    return { accepted: await connectors().answer(c, parsed.data.id, parsed.data) };
  });
}
