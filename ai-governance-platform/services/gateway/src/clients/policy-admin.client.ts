import axios, { AxiosError } from 'axios';
import { Policy } from '@ai-governance/types';
import { AppError } from '@ai-governance/utils';

/**
 * Policy management calls to the internal policy engine. The gateway always supplies the tenant from
 * the caller's verified identity; nothing tenant-related is taken from the client's request.
 */
export class PolicyAdminClient {
  private baseUrl = process.env.POLICY_ENGINE_URL || 'http://policy-engine:3001';

  private rethrow(err: unknown): never {
    const e = err as AxiosError<{ error?: string; problems?: string[] }>;
    if (e.response?.status === 400) {
      const problems = e.response.data?.problems;
      throw new AppError('INVALID_RULES', problems?.length ? problems.join('; ') : e.response.data?.error ?? 'Invalid rule', 400);
    }
    throw new AppError('POLICY_ENGINE_UNAVAILABLE', 'Policy engine unavailable', 503);
  }

  async list(tenantId: string): Promise<Policy[]> {
    try {
      const { data } = await axios.get<Policy[]>(`${this.baseUrl}/v1/policies/${encodeURIComponent(tenantId)}`, { timeout: 5000 });
      return data;
    } catch (err) { this.rethrow(err); }
  }

  async create(tenantId: string, policy: Omit<Policy, 'policyId' | 'createdAt' | 'updatedAt' | 'tenantId'>): Promise<Policy> {
    try {
      const { data } = await axios.post<Policy>(`${this.baseUrl}/v1/policies`, { ...policy, tenantId }, { timeout: 5000 });
      return data;
    } catch (err) { this.rethrow(err); }
  }

  async update(tenantId: string, policy: Policy): Promise<void> {
    try {
      await axios.put(
        `${this.baseUrl}/v1/policies/${encodeURIComponent(tenantId)}/${encodeURIComponent(policy.policyId)}`,
        { ...policy, tenantId },
        { timeout: 5000 }
      );
    } catch (err) { this.rethrow(err); }
  }

  async remove(tenantId: string, policyId: string): Promise<unknown> {
    try {
      const { data } = await axios.delete(`${this.baseUrl}/v1/policies/${encodeURIComponent(tenantId)}/${encodeURIComponent(policyId)}`, { timeout: 5000 });
      return data;
    } catch (err) { this.rethrow(err); }
  }

  /** Compliance calls, always under the given tenant. */
  async compliance(method: 'get' | 'post' | 'delete', path: string, body?: unknown): Promise<unknown> {
    try {
      const { data } = await axios.request({ method, url: `${this.baseUrl}/v1/compliance${path}`, data: body, timeout: 10000 });
      return data;
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      if (e.response?.status === 404) throw new AppError('NOT_FOUND', e.response.data?.error ?? 'Not found', 404);
      this.rethrow(err);
    }
  }
}
