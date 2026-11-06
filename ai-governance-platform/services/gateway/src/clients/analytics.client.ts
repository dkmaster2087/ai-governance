import { FastifyReply, FastifyRequest } from 'fastify';
import { createLogger, INTERNAL_HEADER, InternalCaller, internalKeyFromEnv, signInternal } from '@ai-governance/utils';

const logger = createLogger('gateway:analytics-client');

/**
 * Reports live in the analytics service. The gateway has already checked who is asking and what they may
 * see; it forwards the request with a signed token naming the company and the user. If analytics is down,
 * reports say so and nothing else is affected: prompts never wait on analytics.
 */

export class AnalyticsUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'AnalyticsUnavailableError'; }
}

export const ANALYTICS_UNAVAILABLE = {
  error: 'Reports are unavailable right now. AI traffic is not affected.',
  code: 'ANALYTICS_UNAVAILABLE',
};

export interface AnalyticsAnswer { status: number; body: unknown }

export class AnalyticsClient {
  constructor(
    private baseUrl = process.env.ANALYTICS_URL || 'http://localhost:3003',
    private keyOverride?: string,
    private timeoutMs = 30_000,
  ) {}

  private key(): string {
    return internalKeyFromEnv(this.keyOverride !== undefined ? { INTERNAL_SERVICE_KEY: this.keyOverride } : process.env);
  }

  /** The company and user a request acts for. Reports are for dashboard users only. */
  static callerOf(request: FastifyRequest, tenantId = request.tenantId): InternalCaller {
    const p = request.principal;
    if (!p || p.kind !== 'user') throw new AnalyticsUnavailableError('Reports are for signed-in users');
    return { tenantId, userId: p.userId, role: p.role, ...(p.email ? { email: p.email } : {}) };
  }

  async get(path: string, caller: InternalCaller, query = ''): Promise<AnalyticsAnswer> {
    let token: string;
    try {
      token = signInternal(caller, this.key(), 'analytics');
    } catch (err) {
      logger.error('Analytics is not configured', { error: (err as Error).message });
      throw new AnalyticsUnavailableError('Analytics is not configured');
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}${query ? `?${query}` : ''}`, {
        headers: { [INTERNAL_HEADER]: token, accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      logger.warn('Analytics unreachable', { path, error: (err as Error).message });
      throw new AnalyticsUnavailableError('Analytics is unreachable');
    }
    if (res.status === 401 || res.status >= 500) {
      // 401 here means the two services disagree about the key: an operator problem, not the user's.
      logger.error('Analytics refused or failed', { path, status: res.status });
      throw new AnalyticsUnavailableError(`Analytics answered ${res.status}`);
    }
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  }

  /** A route handler that sends the request on and passes the answer back. */
  forward(path: string | ((request: FastifyRequest) => string), opts: { tenantFrom?: (request: FastifyRequest) => string } = {}) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?') + 1) : '';
      try {
        const caller = AnalyticsClient.callerOf(request, opts.tenantFrom?.(request));
        const answer = await this.get(typeof path === 'function' ? path(request) : path, caller, query);
        return reply.status(answer.status).send(answer.body);
      } catch (err) {
        if (err instanceof AnalyticsUnavailableError) return reply.status(503).send(ANALYTICS_UNAVAILABLE);
        throw err;
      }
    };
  }

  /** For pages that show numbers next to configuration: null when analytics can't answer. */
  async optional<T>(path: string, caller: InternalCaller): Promise<T | null> {
    try {
      const a = await this.get(path, caller);
      return a.status === 200 ? (a.body as T) : null;
    } catch {
      return null;
    }
  }

  async ping(): Promise<void> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`Analytics answered ${res.status}`);
  }
}

let shared: AnalyticsClient | null = null;
export const analyticsClient = () => (shared ??= new AnalyticsClient());
export const setAnalyticsClient = (c: AnalyticsClient | null) => { shared = c; };
