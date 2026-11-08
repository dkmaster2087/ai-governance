import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CATALOG_VERSION, Category } from '@ai-governance/catalog';
import { createLogger } from '@ai-governance/utils';
import { requireAccess, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { publicBase } from '../mcp/base';
import { ShadowAiPolicyStore } from '../services/shadow-ai-policy';
import {
  DEFAULT_FEED_CATEGORIES, FEED_CATEGORIES, FEED_FORMATS, FeedFormat, feedEntries, formatGuide, renderFeed,
} from '../enforcement/feed-formats';
import { Feed, feedStore, MAX_FEEDS, newFeedId, newToken } from '../enforcement/feed-store';
import { AwsLockInput, awsLockPreview, feedPreview, FindingsLike, generateAwsLock, LockInputError } from '../enforcement/aws-lock';

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

interface AwsSettings { gatewayRoleArn?: string; breakGlassRoleArn?: string; targetIds?: string[]; sagemaker?: boolean }

export async function enforcementRoutes(app: FastifyInstance) {
  const store = () => feedStore();
  const base = (request: FastifyRequest) => publicBase(request);

  app.get('/enforcement', { preHandler: requireAccess(TENANT_READ) }, async (request) => {
    const [feeds, approved, aws] = await Promise.all([
      store().list(request.tenantId), approvedTools(request.tenantId), store().getSettings<AwsSettings>(request.tenantId, 'aws'),
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
    };
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
    return {
      domains: entries.length,
      sample: entries.slice(0, 12).map((e) => e.domain),
      ...(parsed.data.findings ? { wouldBeBlocked: feedPreview(parsed.data.findings as FindingsLike, parsed.data.categories, approved), findingsTo: parsed.data.findings.to } : {}),
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
    const { findings: f, ...input } = parsed.data;
    try {
      const files = generateAwsLock(input as AwsLockInput);
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
