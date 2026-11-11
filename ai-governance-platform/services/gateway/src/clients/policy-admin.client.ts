import Fastify, { FastifyInstance, InjectOptions } from 'fastify';
import { Policy } from '@ai-governance/types';
import { AppError } from '@ai-governance/utils';
import { policyRoutes } from '../policy/routes/policy.routes';
import { complianceRoutes } from '../policy/routes/compliance.routes';

/**
 * Rules and compliance management. The routes that used to be the policy engine's run here on a private,
 * in-process app that's never exposed on the network, so their validation and answers are unchanged. The
 * gateway always supplies the tenant from the caller's verified identity; nothing tenant-related is taken
 * from the client's request.
 */
let engine: Promise<FastifyInstance> | null = null;
function inProcessEngine(): Promise<FastifyInstance> {
  return (engine ??= (async () => {
    const app = Fastify({ logger: false }) as unknown as FastifyInstance;
    await app.register(policyRoutes, { prefix: '/v1/policies' });
    await app.register(complianceRoutes, { prefix: '/v1/compliance' });
    await app.ready();
    return app;
  })());
}

type Answer = { statusCode: number; body: string; json: () => any };

export class PolicyAdminClient {
  private async call(opts: InjectOptions): Promise<Answer> {
    let res: Answer;
    try {
      res = (await (await inProcessEngine()).inject(opts)) as unknown as Answer;
    } catch {
      throw new AppError('POLICY_ENGINE_UNAVAILABLE', 'Rules are unavailable', 503);
    }
    if (res.statusCode < 400) return res;
    const data = (() => { try { return res.json(); } catch { return {}; } })() as { error?: string; problems?: string[] };
    if (res.statusCode === 400) {
      throw new AppError('INVALID_RULES', data.problems?.length ? data.problems.join('; ') : data.error ?? 'Invalid rule', 400);
    }
    if (res.statusCode === 404) throw new AppError('NOT_FOUND', data.error ?? 'Not found', 404);
    // Anything else is a storage failure underneath: say rules are unavailable, as the separate service did.
    throw new AppError('POLICY_ENGINE_UNAVAILABLE', 'Rules are unavailable', 503);
  }

  async list(tenantId: string): Promise<Policy[]> {
    return (await this.call({ method: 'GET', url: `/v1/policies/${encodeURIComponent(tenantId)}` })).json();
  }

  async create(tenantId: string, policy: Omit<Policy, 'policyId' | 'createdAt' | 'updatedAt' | 'tenantId'>): Promise<Policy> {
    return (await this.call({ method: 'POST', url: '/v1/policies', payload: { ...policy, tenantId } })).json();
  }

  async update(tenantId: string, policy: Policy): Promise<void> {
    await this.call({ method: 'PUT', url: `/v1/policies/${encodeURIComponent(tenantId)}/${encodeURIComponent(policy.policyId)}`, payload: { ...policy, tenantId } });
  }

  async remove(tenantId: string, policyId: string): Promise<unknown> {
    const res = await this.call({ method: 'DELETE', url: `/v1/policies/${encodeURIComponent(tenantId)}/${encodeURIComponent(policyId)}` });
    return res.body ? res.json() : undefined;
  }

  /** Compliance calls. Every path names the tenant, which the caller took from the verified identity. */
  async compliance(_tenantId: string, method: 'get' | 'post' | 'delete', path: string, body?: unknown): Promise<unknown> {
    const res = await this.call({
      method: method.toUpperCase() as 'GET' | 'POST' | 'DELETE',
      url: `/v1/compliance${path}`,
      ...(body !== undefined || method === 'post' ? { payload: (body ?? {}) as Record<string, unknown> } : {}),
    });
    return res.body ? res.json() : undefined;
  }
}
