import { FastifyInstance } from 'fastify';
import { createLogger } from '@ai-governance/utils';
import { FEED_FORMATS, FeedFormat, feedEntries, renderFeed } from '../enforcement/feed-formats';
import { feedStore } from '../enforcement/feed-store';
import { approvedTools } from './enforcement.routes';

const logger = createLogger('gateway:feeds');

/**
 * The AI-domain feed firewalls fetch. No sign-in, by design: firewalls fetch lists anonymously. The token in the
 * path is the credential; it's revocable, every fetch is logged with the caller's address, and the feed holds
 * only public domain names.
 */
export async function feedRoutes(app: FastifyInstance) {
  app.get<{ Params: { tenantId: string; token: string; format: string } }>('/feeds/:tenantId/:token/:format', {
    config: {
      rateLimit: {
        max: Number(process.env.FEED_RATE_LIMIT ?? 60),
        timeWindow: '1 minute',
        // Per feed, not per address: many firewalls behind one NAT shouldn't share a limit with strangers.
        keyGenerator: (request: any) => `feed:${String(request.params?.token ?? '').split('.')[0]}`,
      },
    },
  }, async (request, reply) => {
    const { tenantId, token, format } = request.params;
    // One answer for every failure, so the URL can't be probed for tenants or feeds.
    const notFound = () => reply.status(404).type('text/plain; charset=utf-8').send('Not found\n');
    if (!FEED_FORMATS.includes(format as FeedFormat)) return notFound();
    const feed = await feedStore().open(tenantId, token);
    if (!feed) {
      logger.warn('Feed fetch refused', { tenantId: tenantId.slice(0, 64), sourceIp: request.clientIp });
      return notFound();
    }
    const out = renderFeed(format as FeedFormat, feedEntries(feed.categories, await approvedTools(tenantId)), {
      name: feed.name, generatedAt: new Date().toISOString(),
    });
    const ua = request.headers['user-agent'];
    await feedStore().recordFetch(feed, { from: request.clientIp, format, agent: Array.isArray(ua) ? ua[0] : ua })
      .catch((err) => logger.error('Failed to record feed fetch', { error: (err as Error).message }));
    logger.info('Feed fetched', { tenantId, feedId: feed.feedId, format, sourceIp: request.clientIp });
    return reply
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .type(out.contentType)
      .send(out.body);
  });
}
