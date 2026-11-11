import { CollectionSpec, MemoryStore, setRecords } from '@ai-governance/storage';
import { GovernanceUnavailableError } from '@ai-governance/utils';
import { PolicyEngineClient } from '../../clients/policy-engine.client';

/** A store whose policies can't be read (a missing table, a database outage). */
class RulesUnreadable extends MemoryStore {
  collection<T extends object>(spec: CollectionSpec) {
    const c = super.collection<T>(spec);
    if (spec.name !== 'policies') return c;
    return Object.assign(Object.create(Object.getPrototypeOf(c)), c, { query: async () => { throw new Error('ResourceNotFoundException: table missing'); } });
  }
}

describe('when the rules can’t be read', () => {
  afterEach(() => setRecords(new MemoryStore()));

  it('reports the check as unavailable, never as "no rules matched"', async () => {
    // An empty list here used to let every prompt through, even for companies that fail closed.
    setRecords(new RulesUnreadable());
    const request = { requestId: 'r', tenantId: 't1', userId: 'u', appId: 'a', provider: 'openai', modelId: 'm', messages: [{ role: 'user', content: 'hi' }], metadata: {}, timestamp: new Date().toISOString() };
    await expect(new PolicyEngineClient().evaluate(request as never)).rejects.toBeInstanceOf(GovernanceUnavailableError);
  });
});
