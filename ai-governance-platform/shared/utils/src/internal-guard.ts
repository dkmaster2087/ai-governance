import { INTERNAL_HEADER, InternalAuthError, InternalCaller, TrustedKey, trustedKeysFromEnv, verifyInternal } from './internal-auth';
import { peerService } from './internal-tls';

/**
 * Makes an internal service answer only signed requests, and only about the company the token is for.
 * Written against the few Fastify calls it needs, so the shared library doesn't depend on Fastify.
 */

interface Req { url: string; method: string; headers: Record<string, unknown>; params?: unknown; body?: unknown; caller?: InternalCaller; raw?: { socket?: unknown } }
interface Reply { status(code: number): { send(body: unknown): unknown } }
interface App {
  decorateRequest(name: string, value: unknown): unknown;
  addHook(name: 'onRequest' | 'preHandler', fn: (req: any, reply: any) => Promise<unknown>): unknown;
}

export interface InternalGuardOptions {
  /** This service's name; tokens must be made for it. */
  audience: string;
  /** Paths answered without a token. */
  open?: string[];
  /** Which roles may call which paths. Default: any role, any path. */
  allow?: (role: string, method: string, path: string) => boolean;
  /**
   * With mutual TLS on: the services whose certificates may call (by name). The gateway acts for people;
   * a reporting agent's certificate may carry only reporting-agent tokens.
   */
  peers?: string[];
  /** Where refusals are logged. */
  onRefused?: (reason: string, path: string) => void;
  /** The public keys accepted; default from INTERNAL_TRUSTED_KEYS. */
  trusted?: () => TrustedKey[];
}

/** Every company a request names: in the path (`:tenantId`) or the body (`tenantId`). */
function tenantsNamed(req: Req): string[] {
  const out: string[] = [];
  const p = req.params as Record<string, unknown> | undefined;
  if (typeof p?.tenantId === 'string') out.push(p.tenantId);
  const b = req.body as Record<string, unknown> | undefined;
  if (b && typeof b === 'object' && 'tenantId' in b) out.push(String(b.tenantId));
  return out;
}

export function guardInternal(app: App, o: InternalGuardOptions): void {
  const open = new Set(o.open ?? ['/health', '/health/ready']);
  const refuse = (reply: Reply, path: string, reason: string, code = 401) => {
    o.onRefused?.(reason, path);
    return reply.status(code).send({ error: code === 401 ? 'Only Probaline’s own services may call this' : reason, code: code === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' });
  };
  app.decorateRequest('caller', null);

  app.addHook('onRequest', async (req: Req, reply: Reply) => {
    const path = req.url.split('?')[0];
    if (open.has(path)) return;
    // Which service is calling, proven by its certificate (when mutual TLS is on).
    const peer = o.peers ? peerService(req.raw?.socket) : null;
    if (o.peers && (!peer || !o.peers.includes(peer))) return refuse(reply, path, peer ? `Service ${peer} may not call this` : 'No valid service certificate');
    const token = req.headers[INTERNAL_HEADER];
    try {
      if (typeof token !== 'string') throw new InternalAuthError('Missing token');
      req.caller = verifyInternal(token, (o.trusted ?? trustedKeysFromEnv)(), o.audience);
    } catch (err) {
      return refuse(reply, path, (err as Error).message);
    }
    if (peer === 'reporting-agent' && req.caller.role !== 'reporting_agent') return refuse(reply, path, 'A reporting agent may act only as itself', 403);
    if (o.allow && !o.allow(req.caller.role, req.method, path)) return refuse(reply, path, 'This caller may not use this', 403);
  });

  // After the body is read: a token for one company can't act on another.
  app.addHook('preHandler', async (req: Req, reply: Reply) => {
    if (!req.caller) return;
    const other = tenantsNamed(req).find((t) => t !== req.caller!.tenantId);
    if (other !== undefined) return refuse(reply, req.url.split('?')[0], 'The request names a different company than the token', 403);
  });
}
