import { MemoryStore, setRecords } from '@ai-governance/storage';
import { PolicyAdminClient } from '../clients/policy-admin.client';

// Rules and compliance used to be a separate service; they now run in the gateway with the same answers.
describe('rules and compliance, in the gateway', () => {
  beforeEach(() => setRecords(new MemoryStore()));
  const client = new PolicyAdminClient();
  const rule = (patterns: string[]) => ({
    ruleId: 'r1', type: 'data_classification' as const, action: 'block' as const, priority: 1, enabled: true, config: { patterns }, description: 'Invoices',
  });

  it('creates, lists, changes and removes a company’s policies', async () => {
    const p = await client.create('t1', { name: 'Custom rules', description: '', enabled: true, rules: [rule(['INV-\\d{6}'])], createdBy: 'u' });
    expect((await client.list('t1')).map((x) => x.policyId)).toEqual([p.policyId]);
    expect(await client.list('t2')).toEqual([]);
    await client.update('t1', { ...p, rules: [rule(['PO-\\d{4}'])] });
    expect((await client.list('t1'))[0].rules[0].config.patterns).toEqual(['PO-\\d{4}']);
    await client.remove('t1', p.policyId);
    expect(await client.list('t1')).toEqual([]);
  });

  it('refuses an unsafe pattern with the reason, as before', async () => {
    await expect(client.create('t1', { name: 'Custom rules', description: '', enabled: true, rules: [rule(['(a+)+$'])], createdBy: 'u' }))
      .rejects.toMatchObject({ code: 'INVALID_RULES', statusCode: 400 });
  });

  it('runs compliance actions, and answers not found for an unknown framework', async () => {
    await client.compliance('t1', 'post', '/enable/t1/soc2', { enabledBy: 'u' });
    expect(await client.compliance('t1', 'get', '/status/t1')).toEqual(expect.arrayContaining([expect.objectContaining({ framework: 'soc2' })]));
    await expect(client.compliance('t1', 'post', '/assess/t1/soc2')).resolves.toMatchObject({ framework: 'soc2' });
    await expect(client.compliance('t1', 'post', '/assess/t1/nist')).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });
});
