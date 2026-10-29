import { PolicyEvaluator } from '../services/policy.evaluator';
import { PolicyRepository } from '../repositories/policy.repository';
import { NormalizedAIRequest, Policy, PolicyRule } from '@ai-governance/types';

jest.mock('../repositories/policy.repository');
const MockRepo = PolicyRepository as jest.MockedClass<typeof PolicyRepository>;

const request = (content: string, modelId = 'gpt-4o'): NormalizedAIRequest => ({
  requestId: 'r', tenantId: 't', userId: 'u', appId: 'a', provider: 'openai', modelId,
  messages: [{ role: 'user', content }], metadata: {}, timestamp: '',
});
const withRule = (rule: Partial<PolicyRule>): Policy[] => [{
  policyId: 'p', tenantId: 't', name: 'n', description: '', enabled: true, createdAt: '', updatedAt: '', createdBy: 'x',
  rules: [{ ruleId: 'r1', type: 'keyword_block', action: 'block', priority: 1, enabled: true, config: {}, description: 'Stop it', ...rule } as PolicyRule],
}];

describe('policy evidence', () => {
  beforeEach(() => jest.clearAllMocks());

  it('captures the keyword and the text around it, keeping original case', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue(withRule({ config: { keywords: ['confidential'] } }));
    const result = await new PolicyEvaluator().evaluate(request('Please summarise the attached Confidential pricing memo for the board.'));
    expect(result.evidence).toEqual({
      ruleId: 'r1', ruleType: 'keyword_block',
      before: 'Please summarise the attached ', hit: 'Confidential', after: ' pricing memo for the board.',
    });
  });

  it('masks personal data around the match', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue(withRule({ config: { keywords: ['confidential'] } }));
    const result = await new PolicyEvaluator().evaluate(request('Email jane@example.com the confidential plan'));
    expect(result.evidence?.before).toBe('Email [PII] the ');
    expect(JSON.stringify(result.evidence)).not.toContain('jane@example.com');
  });

  it('labels a personal-data match instead of storing it', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue(withRule({ type: 'pii_detection', config: { piiTypes: ['SSN'] } }));
    const result = await new PolicyEvaluator().evaluate(request('Update the record for 123-45-6789 today'));
    expect(result.evidence?.hit).toBe('[SSN]');
    expect(JSON.stringify(result.evidence)).not.toContain('123-45-6789');
  });

  it('records the model for model restrictions', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue(withRule({ type: 'model_restriction', config: { allowedModels: ['claude-3-haiku'] } }));
    const result = await new PolicyEvaluator().evaluate(request('hello', 'gpt-4o-mini'));
    expect(result.evidence).toMatchObject({ before: 'model: ', hit: 'gpt-4o-mini', after: '' });
  });

  it('shortens long context to a window around the match', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue(withRule({ config: { keywords: ['secret'] } }));
    const long = 'word '.repeat(60) + 'secret ' + 'tail '.repeat(60);
    const result = await new PolicyEvaluator().evaluate(request(long));
    expect(result.evidence!.before.startsWith('…')).toBe(true);
    expect(result.evidence!.after.endsWith('…')).toBe(true);
    expect(result.evidence!.before.length).toBeLessThanOrEqual(62);
  });

  it('adds no evidence when nothing is stopped', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue(withRule({ config: { keywords: ['confidential'] } }));
    const result = await new PolicyEvaluator().evaluate(request('All good here'));
    expect(result.evidence).toBeUndefined();
  });
});
