import { timingSafeEqual } from 'crypto';
import { FastifyRequest } from 'fastify';

/**
 * The address a request really came from, for per-address limits and the activity trail.
 *
 * `X-Forwarded-For` is a list each proxy appends to, and anything left of the proxies we run is whatever the
 * caller wrote, so only the right-most entries can be believed: one per proxy in front of the gateway.
 *
 *   TRUSTED_PROXY_HOPS  How many proxies sit in front of the gateway (default 0: use the connection's address).
 *                       On AWS this is 1, the load balancer. Behind your own nginx or load balancer, set 1.
 *   EDGE_SECRET         On AWS, CloudFront sends this in `x-probaline-edge` on the dashboard's and website's
 *                       /api calls. When it matches, CloudFront's hop is trusted too, so the address is the
 *                       person's browser, not the CloudFront location. A caller who doesn't know it gets the
 *                       load balancer's view of them, which they can't change.
 */
export const EDGE_HEADER = 'x-probaline-edge';

export interface ClientAddressConfig { hops: number; edgeSecret?: string }

export function clientAddressConfig(env: NodeJS.ProcessEnv = process.env): ClientAddressConfig {
  const hops = Number(env.TRUSTED_PROXY_HOPS ?? 0);
  if (!Number.isInteger(hops) || hops < 0 || hops > 5) throw new Error('TRUSTED_PROXY_HOPS must be a whole number from 0 to 5');
  const edgeSecret = env.EDGE_SECRET?.trim() || undefined;
  return { hops, edgeSecret };
}

function sameSecret(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when the request came through our CloudFront (it carries the edge secret). */
export function fromEdge(request: Pick<FastifyRequest, 'headers'>, config: ClientAddressConfig): boolean {
  return !!config.edgeSecret && config.hops > 0 && sameSecret(request.headers[EDGE_HEADER], config.edgeSecret);
}

export function clientAddress(request: Pick<FastifyRequest, 'headers' | 'socket'>, config: ClientAddressConfig): string {
  const socket = request.socket?.remoteAddress ?? 'unknown';
  const trusted = config.hops + (fromEdge(request, config) ? 1 : 0);
  if (trusted === 0) return socket;
  const header = request.headers['x-forwarded-for'];
  const chain = (Array.isArray(header) ? header.join(',') : header ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  // The entry our outermost trusted proxy added. Fewer entries than proxies means the request skipped them,
  // so nothing in the header can be believed.
  const entry = chain[chain.length - trusted];
  return entry ?? socket;
}
