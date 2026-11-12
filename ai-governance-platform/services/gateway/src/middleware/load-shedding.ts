import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { monitorEventLoopDelay } from 'perf_hooks';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:load');

/** Routes that carry AI traffic: shed these first when the copy is overloaded; dashboards and health stay up. */
export const isAiTraffic = (method: string, path: string) =>
  method === 'POST' && (path === '/v1/chat/completions' || path.startsWith('/v1/proxy/') || path.startsWith('/v1/guardrails/') || path.startsWith('/mcp/'));

export interface LoadSheddingOptions {
  /** Refuse new AI requests while the event loop's p99 delay over the last second is above this (CPU saturated). */
  maxLagMs?: number;
  /** And while this many AI requests are already open on this copy (a memory guard; long answers count). */
  maxOpen?: number;
  /** Test hook: report the current lag instead of measuring it. */
  lag?: () => number;
}

/**
 * When a gateway copy is overloaded it answers new AI requests at once with `503 BUSY` and `Retry-After: 1`,
 * instead of slowing every request down. Requests already running are never cut off. Callers (apps, the IDE proxy,
 * another gateway's guardrail) retry, and the load balancer moves them to a copy with room while more start.
 *
 * Overloaded means the CPU is saturated (Node's event loop is late by more than `maxLagMs`), not merely many open
 * requests: an AI answer can stream for a minute while costing almost nothing.
 */
export const loadShedding = fp(async (app: FastifyInstance, opts: LoadSheddingOptions) => {
  const maxLagMs = opts.maxLagMs ?? (Number(process.env.SHED_LAG_MS) || 250);
  const maxOpen = opts.maxOpen ?? (Number(process.env.SHED_MAX_OPEN) || 5000);
  let open = 0;
  let lagMs = 0;
  let warnedAt = 0;

  let timer: NodeJS.Timeout | null = null;
  if (!opts.lag) {
    const histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
    timer = setInterval(() => {
      lagMs = histogram.percentile(99) / 1e6;
      histogram.reset();
    }, 1000);
    timer.unref();
    app.addHook('onClose', async () => { if (timer) clearInterval(timer); histogram.disable(); });
  }
  const currentLag = () => (opts.lag ? opts.lag() : lagMs);

  app.addHook('onRequest', async (request, reply) => {
    if (!isAiTraffic(request.method, request.url.split('?')[0])) return;
    const lag = currentLag();
    if (lag > maxLagMs || open >= maxOpen) {
      const now = Date.now();
      if (now - warnedAt > 10_000) {
        warnedAt = now;
        logger.warn('Overloaded: refusing new AI requests for now', { lagMs: Math.round(lag), open });
      }
      return reply.status(503).header('retry-after', '1').send({ error: 'Probaline is busy. Try again in a second.', code: 'BUSY' });
    }
    open++;
    let released = false;
    const release = () => { if (!released) { released = true; open--; } };
    // 'close' fires for every response, streamed or not, and when the caller goes away.
    reply.raw.once('close', release);
    reply.raw.once('finish', release);
  });
});
