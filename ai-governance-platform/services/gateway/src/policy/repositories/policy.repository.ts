import { allPages, collection } from '@ai-governance/storage';
import { Policy } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { randomUUID } from 'crypto';
import { forgetCachedPolicies } from '../policy-cache';

const logger = createLogger('policy-engine:repository');

export class PolicyRepository {
  private policies = () => collection<Policy & Record<string, unknown>>('policies');

  /**
   * A company's policies. If they can't be read this throws: an empty list would look like "no rules" and let
   * every prompt through, even for a company that fails closed. The caller applies the company's fail mode.
   */
  async getPoliciesForTenant(tenantId: string): Promise<Policy[]> {
    try {
      return await allPages((after) => this.policies().query({ partition: tenantId, after }));
    } catch (err) {
      logger.error('Failed to fetch policies', { tenantId, error: (err as Error).message });
      throw err;
    }
  }

  /** Find a policy linked to a specific compliance framework */
  async findByFramework(tenantId: string, framework: string): Promise<Policy | null> {
    const policies = await this.getPoliciesForTenant(tenantId);
    return policies.find((p) => p.sourceFramework === framework) ?? null;
  }

  async createPolicy(data: Omit<Policy, 'policyId' | 'createdAt' | 'updatedAt'>): Promise<Policy> {
    const policy: Policy = {
      ...data,
      policyId: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.policies().put(policy as Policy & Record<string, unknown>);
    forgetCachedPolicies(policy.tenantId);
    return policy;
  }

  /** Replace a policy's name, description, enabled flag and rules; other fields (sourceFramework) are kept. */
  async updatePolicy(policyId: string, data: Partial<Policy>): Promise<Policy> {
    const tenantId = data.tenantId;
    if (!tenantId) throw new Error('tenantId required for updatePolicy');
    const updatedAt = new Date().toISOString();
    const set: Record<string, unknown> = { rules: data.rules ?? [], updatedAt };
    for (const f of ['name', 'description', 'enabled', 'sourceFramework'] as const) {
      if (data[f] !== undefined) set[f] = data[f];
    }
    const updated = await this.policies().update({ tenantId, policyId }, { set });
    forgetCachedPolicies(tenantId);
    return (updated ?? { ...data, policyId, updatedAt }) as Policy;
  }

  /** Enable or disable a policy without changing anything else */
  async setEnabled(policyId: string, tenantId: string, enabled: boolean): Promise<void> {
    await this.policies().update({ tenantId, policyId }, { set: { enabled, updatedAt: new Date().toISOString() }, ifExists: true });
    forgetCachedPolicies(tenantId);
  }

  async deletePolicy(policyId: string, tenantId: string): Promise<void> {
    await this.policies().delete({ tenantId, policyId });
    forgetCachedPolicies(tenantId);
  }
}
