import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CATALOG_VERSION, Category } from '@ai-governance/catalog';
import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { requireAccess, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { publicBase } from '../mcp/base';
import { ShadowAiPolicyStore } from '../services/shadow-ai-policy';
import {
  DEFAULT_FEED_CATEGORIES, FEED_CATEGORIES, FEED_FORMATS, FeedFormat, feedEntries, formatGuide, renderFeed,
} from '../enforcement/feed-formats';
import { Feed, feedStore, MAX_FEEDS, newFeedId, newToken } from '../enforcement/feed-store';
import { AwsLockInput, awsLockPreview, feedPreview, FindingsLike, generateAwsLock, LockInputError } from '../enforcement/aws-lock';
import {
  findingsStore, FindingsError, PATH_STATES, PathId, PATHS, PathState, PathStateRecord, pathStatus, StoredFindings, trimFindings,
} from '../enforcement/paths';

const logger = createLogger('gateway:enforcement');

/** The gateway's outbound addresses, for the "except from the gateway" rule (the deployment's NAT addresses). */
export const egressIps = () => (process.env.GATEWAY_EGRESS_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const CATEGORY_IDS = FEED_CATEGORIES.map((c) => c.id) as [Category, ...Category[]];
const categories = z.array(z.enum(CATEGORY_IDS)).min(1, 'Choose at least one kind of AI service').max(CATEGORY_IDS.length);
const feedBody = z.object({ name: z.string().trim().min(1).max(60), categories });
// A findings file from the collector; only the fields the previews read are checked.
const findings = z.object({
  to: z.string().max(20).optional(),
  catalogVersion: z.string().max(20).optional(),
  services: z.array(z.object({ id: z.string().max(80), name: z.string().max(120), category: z.string().max(20), people: z.number(), machines: z.number(), count: z.number() })).max(1000).optional(),
  cloudAi: z.array(z.object({ who: z.string().max(220), services: z.array(z.string().max(120)).max(50), count: z.number() })).max(1000).optional(),
  directApi: z.array(z.object({ who: z.string().max(220), services: z.array(z.string().max(120)).max(50), count: z.number() })).max(1000).optional(),
  paths: z.array(z.object({ id: z.string().max(20), stillDirect: z.array(z.object({ who: z.string().max(220), services: z.array(z.string().max(120)).max(50), count: z.number() })).max(1000) })).max(10).optional(),
}).passthrough();
const awsBody = z.object({
  gatewayRoleArn: z.string().trim().max(600),
  breakGlassRoleArn: z.string().trim().max(600).optional().or(z.literal('').transform(() => undefined)),
  targetIds: z.array(z.string().trim().max(80)).max(20).optional(),
  sagemaker: z.boolean().optional(),
});

const firstIssue = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message) : 'Invalid request';
};
const bad = (message: string, code = 'INVALID_REQUEST') => ({ error: message, code });

export const feedUrls = (base: string, tenantId: string, token: string) =>
  Object.fromEntries(FEED_FORMATS.map((f) => [f, `${base}/public/feeds/${tenantId}/${token}/${f}`])) as Record<FeedFormat, string>;

/** A feed as the dashboard sees it: never the token. */
export function feedView(f: Feed, approvedIds: string[]) {
  return {
    feedId: f.feedId, name: f.name, categories: f.categories, tokenHint: f.tokenHint,
    domains: feedEntries(f.categories, approvedIds).length,
    createdAt: f.createdAt, updatedAt: f.updatedAt,
    lastFetchedAt: f.lastFetchedAt, lastFetchedFrom: f.lastFetchedFrom, lastFetchedFormat: f.lastFetchedFormat, lastFetchedAgent: f.lastFetchedAgent,
    fetchCount: f.fetchCount ?? 0,
  };
}

/** Tools allowed on the Shadow AI page: people may use them, so feeds leave them out. */
export async function approvedTools(tenantId: string): Promise<string[]> {
  const policy = await new ShadowAiPolicyStore().get(tenantId);
  return Object.entries(policy.decisions).filter(([, d]) => d === 'allowed').map(([id]) => id);
}

/** A stored findings file as the page lists it. */
export const findingsView = (f: StoredFindings) => ({
  findingsId: f.findingsId, from: f.from, to: f.to, catalogVersion: f.catalogVersion, uploadedAt: f.uploadedAt, uploadedBy: f.uploadedBy,
  fileName: f.fileName, services: f.services.length,
});

/** The findings a preview uses: the one sent with it, or the latest stored. */
async function findingsFor(tenantId: string, sent?: FindingsLike): Promise<FindingsLike | null> {
  return sent ?? ((await findingsStore().latest(tenantId)) as FindingsLike | null);
}

/**
 * Every API behind this company's MCP servers, with what its verifier needs: the issuer and keys address
 * (the gateway), and the audience (the API's base URL, exactly as added). No credentials.
 */
export async function lockKitApis(tenantId: string, issuer: string) {
  const all = async (name: 'mcpServers' | 'mcpApis' | 'mcpConnectors') => {
    const out: Record<string, any>[] = [];
    let after: string | undefined;
    do {
      const page = await collection<Record<string, any>>(name).query({ partition: tenantId, limit: 200, after });
      out.push(...page.items);
      after = page.next;
    } while (after && out.length < 1000);
    return out;
  };
  const [servers, apis, connectors] = await Promise.all([all('mcpServers'), all('mcpApis'), all('mcpConnectors')]);
  const serverName = new Map(servers.map((sv) => [sv.serverId, sv.name as string]));
  const connectorName = new Map(connectors.filter((c) => c.connectorId).map((c) => [c.connectorId, c.name as string]));
  return {
    issuer,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    header: 'X-Probaline-Identity',
    tokenLifetimeSeconds: 300,
    egressIps: egressIps(),
    apis: apis
      .filter((a) => serverName.has(a.serverId))
      .map((a) => ({
        apiId: a.apiId as string, name: a.name as string, serverId: a.serverId as string, serverName: serverName.get(a.serverId) as string, audience: a.baseUrl as string,
        ...(a.connectorId ? { connector: connectorName.get(a.connectorId) ?? (a.connectorId as string) } : {}),
      }))
      .sort((x, y) => `${x.serverName}${x.name}`.localeCompare(`${y.serverName}${y.name}`)),
  };
}

interface AwsSettings { gatewayRoleArn?: string; breakGlassRoleArn?: string; targetIds?: string[]; sagemaker?: boolean }

export async function enforcementRoutes(app: FastifyInstance) {
  const store = () => feedStore();
  const base = (request: FastifyRequest) => publicBase(request);

  app.get('/enforcement', { preHandler: requireAccess(TENANT_READ) }, async (request) => {
    const [feeds, approved, aws, states, findings] = await Promise.all([
      store().list(request.tenantId), approvedTools(request.tenantId), store().getSettings<AwsSettings>(request.tenantId, 'aws'),
      store().getSettings<Partial<Record<PathId, PathStateRecord>>>(request.tenantId, 'paths'), findingsStore().list(request.tenantId),
    ]);
    return {
      catalogVersion: CATALOG_VERSION,
      egressIps: egressIps(),
      categories: FEED_CATEGORIES,
      defaultCategories: DEFAULT_FEED_CATEGORIES,
      formats: formatGuide(egressIps()),
      feeds: feeds.map((f) => feedView(f, approved)),
      maxFeeds: MAX_FEEDS,
      approvedTools: approved,
      aws: { ...(aws ?? {}), gatewayRoleArn: aws?.gatewayRoleArn || process.env.GATEWAY_ROLE_ARN || '' },
      paths: pathStatus(states ?? {}, findings),
      findings: findings.map(findingsView),
    };
  });

  // ── Incoming: lock your APIs to Probaline ──────────────────────────────────────────────────────────────────

  /**
   * Every API behind this company's MCP servers, with what its verifier needs: the issuer and keys address
   * (the gateway), and the audience (the API's base URL, exactly as added). No credentials.
   */
  app.get('/enforcement/apis', { preHandler: requireAccess(TENANT_READ) }, async (request) => lockKitApis(request.tenantId, base(request)));

  /**
   * The same list as a file for the collector, so it can tell calls to these APIs apart in access logs: hosts and
   * base paths only, plus the gateway's outbound addresses (calls from them came through Probaline).
   */
  app.get('/enforcement/apis/export', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const kit = await lockKitApis(request.tenantId, base(request));
    const apis = kit.apis.flatMap((a) => {
      try {
        const u = new URL(a.audience);
        return [{ apiId: a.apiId, name: a.name, server: a.serverName, host: u.host.toLowerCase(), basePath: u.pathname.replace(/\/+$/, '') || '/', ...(a.connector ? { connector: a.connector } : {}) }];
      } catch { return []; }
    });
    const body = { schema: 'probaline.api_inventory/1', generatedAt: new Date().toISOString(), gateway: { issuer: kit.issuer, egressIps: kit.egressIps }, apis };
    return reply
      .header('content-disposition', `attachment; filename="probaline-apis-${new Date().toISOString().slice(0, 10)}.json"`)
      .send(body);
  });

  // ── Paths and findings files ───────────────────────────────────────────────────────────────────────────────

  /** What the admin says about a path. The page shows it next to what the findings show. */
  app.put<{ Params: { pathId: string } }>('/enforcement/paths/:pathId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const def = PATHS.find((p) => p.id === request.params.pathId);
    if (!def) return reply.status(404).send(bad('Unknown path', 'NOT_FOUND'));
    if (def.coming) return reply.status(409).send(bad('This path can’t be locked with Probaline yet', 'NOT_AVAILABLE'));
    const parsed = z.object({ state: z.enum(PATH_STATES as [PathState, ...PathState[]]) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(bad(firstIssue(parsed.error), 'INVALID_STATE'));
    const states = (await store().getSettings<Partial<Record<PathId, PathStateRecord>>>(request.tenantId, 'paths')) ?? {};
    states[def.id] = { state: parsed.data.state, updatedAt: new Date().toISOString(), ...(request.userId ? { updatedBy: request.userId } : {}) };
    await store().saveSettings(request.tenantId, 'paths', states, request.userId);
    return { path: pathStatus(states, await findingsStore().list(request.tenantId)).find((p) => p.id === def.id) };
  });

  /** Keep a collector findings file: trimmed to what the page uses, kept 400 days, at most 100. */
  app.post('/enforcement/findings', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const body = (request.body ?? {}) as { findings?: unknown; fileName?: unknown };
    try {
      const trimmed = trimFindings(body.findings);
      const saved = await findingsStore().save({
        ...trimmed, tenantId: request.tenantId, ...(request.userId ? { uploadedBy: request.userId } : {}),
        ...(typeof body.fileName === 'string' ? { fileName: body.fileName.replace(/[^\w.\- ]/g, '').slice(0, 120) } : {}),
      });
      logger.info('Findings uploaded', { tenantId: request.tenantId, findingsId: saved.findingsId, to: saved.to });
      return reply.status(201).send({ findings: findingsView(saved), findingsId: saved.findingsId });
    } catch (err) {
      if (err instanceof FindingsError) return reply.status(400).send(bad(err.message, 'INVALID_FINDINGS'));
      throw err;
    }
  });

  app.delete<{ Params: { findingsId: string } }>('/enforcement/findings/:findingsId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    if (!(await findingsStore().remove(request.tenantId, request.params.findingsId))) return reply.status(404).send(bad('Findings file not found', 'NOT_FOUND'));
    return reply.status(204).send();
  });

  // ── Feeds ──────────────────────────────────────────────────────────────────────────────────────────────────

  app.post('/enforcement/feeds', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = feedBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(bad(firstIssue(parsed.error), 'INVALID_FEED'));
    if ((await store().list(request.tenantId)).length >= MAX_FEEDS) return reply.status(409).send(bad(`At most ${MAX_FEEDS} feeds`, 'TOO_MANY_FEEDS'));
    const feedId = newFeedId();
    const t = newToken(feedId);
    const now = new Date().toISOString();
    const feed: Feed = {
      tenantId: request.tenantId, recordKey: `feed#${feedId}`, feedId, name: parsed.data.name, categories: [...new Set(parsed.data.categories)],
      tokenHash: t.tokenHash, tokenHint: t.tokenHint, createdAt: now, createdBy: request.userId, updatedAt: now, fetchCount: 0,
    };
    await store().create(feed);
    logger.info('Feed created', { tenantId: request.tenantId, feedId });
    return reply.status(201).send({ feed: feedView(feed, await approvedTools(request.tenantId)), feedId, urls: feedUrls(base(request), request.tenantId, t.token) });
  });

  app.patch<{ Params: { feedId: string } }>('/enforcement/feeds/:feedId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = feedBody.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(bad(firstIssue(parsed.error), 'INVALID_FEED'));
    const set: Partial<Feed> = {};
    if (parsed.data.name) set.name = parsed.data.name;
    if (parsed.data.categories) set.categories = [...new Set(parsed.data.categories)];
    const feed = await store().update(request.tenantId, request.params.feedId, set);
    if (!feed) return reply.status(404).send(bad('Feed not found', 'NOT_FOUND'));
    return { feed: feedView(feed, await approvedTools(request.tenantId)) };
  });

  /** A new token: the old URLs stop working at once. */
  app.post<{ Params: { feedId: string } }>('/enforcement/feeds/:feedId/rotate', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const t = newToken(request.params.feedId);
    const feed = await store().update(request.tenantId, request.params.feedId, { tokenHash: t.tokenHash, tokenHint: t.tokenHint });
    if (!feed) return reply.status(404).send(bad('Feed not found', 'NOT_FOUND'));
    return { feed: feedView(feed, await approvedTools(request.tenantId)), feedId: feed.feedId, urls: feedUrls(base(request), request.tenantId, t.token) };
  });

  app.delete<{ Params: { feedId: string } }>('/enforcement/feeds/:feedId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    if (!(await store().get(request.tenantId, request.params.feedId))) return reply.status(404).send(bad('Feed not found', 'NOT_FOUND'));
    await store().remove(request.tenantId, request.params.feedId);
    logger.info('Feed revoked', { tenantId: request.tenantId, feedId: request.params.feedId });
    return reply.status(204).send();
  });

  /** The feed's content, for an admin to read before a firewall fetches it. */
  app.get<{ Params: { feedId: string; format: string } }>('/enforcement/feeds/:feedId/content/:format', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const format = request.params.format as FeedFormat;
    if (!FEED_FORMATS.includes(format)) return reply.status(404).send(bad('Unknown format', 'NOT_FOUND'));
    const feed = await store().get(request.tenantId, request.params.feedId);
    if (!feed) return reply.status(404).send(bad('Feed not found', 'NOT_FOUND'));
    const out = renderFeed(format, feedEntries(feed.categories, await approvedTools(request.tenantId)), { name: feed.name, generatedAt: new Date().toISOString() });
    return reply.type(out.contentType).send(out.body);
  });

  /** What a feed with these categories would contain, and stop, given a collector findings file. Nothing is saved. */
  app.post('/enforcement/feeds/preview', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const parsed = z.object({ categories, findings: findings.optional() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(bad(firstIssue(parsed.error)));
    const approved = await approvedTools(request.tenantId);
    const entries = feedEntries(parsed.data.categories, approved);
    const f = await findingsFor(request.tenantId, parsed.data.findings as FindingsLike | undefined);
    return {
      domains: entries.length,
      sample: entries.slice(0, 12).map((e) => e.domain),
      ...(f ? { wouldBeBlocked: feedPreview(f, parsed.data.categories, approved), findingsTo: f.to } : {}),
    };
  });

  // ── AWS lock ───────────────────────────────────────────────────────────────────────────────────────────────

  app.put('/enforcement/aws', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = awsBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(bad(firstIssue(parsed.error), 'INVALID_LOCK'));
    try { generateAwsLock(parsed.data as AwsLockInput); } catch (err) {
      if (err instanceof LockInputError) return reply.status(400).send(bad(err.message, 'INVALID_LOCK'));
      throw err;
    }
    await store().saveSettings(request.tenantId, 'aws', parsed.data, request.userId);
    return { aws: parsed.data };
  });

  /** The policies, and who they would refuse according to a findings file. Recorded as admin activity. */
  app.post('/enforcement/aws/generate', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = awsBody.extend({ findings: findings.optional() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(bad(firstIssue(parsed.error), 'INVALID_LOCK'));
    const { findings: sent, ...input } = parsed.data;
    try {
      const files = generateAwsLock(input as AwsLockInput);
      const f = await findingsFor(request.tenantId, sent as FindingsLike | undefined);
      return {
        ...files,
        ...(f ? { wouldBeBlocked: awsLockPreview(f as FindingsLike, input as AwsLockInput), findingsTo: f.to } : {}),
      };
    } catch (err) {
      if (err instanceof LockInputError) return reply.status(400).send(bad(err.message, 'INVALID_LOCK'));
      throw err;
    }
  });
}
