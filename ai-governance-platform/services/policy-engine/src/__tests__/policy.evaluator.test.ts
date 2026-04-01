import { PolicyEvaluator } from '../services/policy.evaluator';
import { PolicyRepository } from '../repositories/policy.repository';
import { NormalizedAIRequest, Policy } from '@ai-governance/types';

jest.mock('../repositories/policy.repository');
const MockRepo = PolicyRepository as jest.MockedClass<typeof PolicyRepository>;

const makeRequest = (content: string, modelId = 'anthropic.claude-3-haiku-20240307-v1:0'): NormalizedAIRequest => ({
  requestId: 'req_test',
  tenantId: 'tenant_123',
  userId: 'user_1',
  appId: 'app_1',
  provider: 'bedrock',
  modelId,
  messages: [{ role: 'user', content }],
  metadata: {},
  timestamp: new Date().toISOString(),
});

const makePolicy = (rules: Policy['rules']): Policy => ({
  policyId: 'policy_1',
  tenantId: 'tenant_123',
  name: 'Test Policy',
  description: 'Test',
  enabled: true,
  rules,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdBy: 'admin',
});

describe('PolicyEvaluator', () => {
  let evaluator: PolicyEvaluator;

  beforeEach(() => {
    jest.clearAllMocks();
    evaluator = new PolicyEvaluator();
  });

  it('allows request when no policies exist', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue([]);
    const result = await evaluator.evaluate(makeRequest('Hello world'));
    expect(result.allowed).toBe(true);
    expect(result.triggeredRules).toHaveLength(0);
  });

  it('blocks request matching keyword_block rule', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue([
      makePolicy([{
        ruleId: 'rule_1',
        type: 'keyword_block',
        action: 'block',
        priority: 1,
        enabled: true,
        config: { keywords: ['confidential', 'secret'] },
        description: 'Block confidential keywords',
      }]),
    ]);

    const result = await evaluator.evaluate(makeRequest('This is confidential data'));
    expect(result.allowed).toBe(false);
    expect(result.action).toBe('block');
    expect(result.triggeredRules).toContain('rule_1');
  });

  it('allows request not matching keyword_block rule', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue([
      makePolicy([{
        ruleId: 'rule_1',
        type: 'keyword_block',
        action: 'block',
        priority: 1,
        enabled: true,
        config: { keywords: ['confidential'] },
        description: 'Block confidential',
      }]),
    ]);

    const result = await evaluator.evaluate(makeRequest('Hello, how are you?'));
    expect(result.allowed).toBe(true);
  });

  it('blocks request using disallowed model', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue([
      makePolicy([{
        ruleId: 'rule_2',
        type: 'model_restriction',
        action: 'block',
        priority: 1,
        enabled: true,
        config: { allowedModels: ['anthropic.claude-3-sonnet-20240229-v1:0'] },
        description: 'Only allow Sonnet',
      }]),
    ]);

    const result = await evaluator.evaluate(makeRequest('Hello', 'gpt-4o'));
    expect(result.allowed).toBe(false);
  });

  it('skips disabled rules', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue([
      makePolicy([{
        ruleId: 'rule_disabled',
        type: 'keyword_block',
        action: 'block',
        priority: 1,
        enabled: false,
        config: { keywords: ['confidential'] },
        description: 'Disabled rule',
      }]),
    ]);

    const result = await evaluator.evaluate(makeRequest('confidential data'));
    expect(result.allowed).toBe(true);
  });

  it('caps risk score at 100', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue([
      makePolicy([
        { ruleId: 'r1', type: 'keyword_block', action: 'warn', priority: 1, enabled: true, config: { keywords: ['bad'] }, description: '' },
        { ruleId: 'r2', type: 'keyword_block', action: 'warn', priority: 2, enabled: true, config: { keywords: ['bad'] }, description: '' },
        { ruleId: 'r3', type: 'keyword_block', action: 'warn', priority: 3, enabled: true, config: { keywords: ['bad'] }, description: '' },
        { ruleId: 'r4', type: 'keyword_block', action: 'warn', priority: 4, enabled: true, config: { keywords: ['bad'] }, description: '' },
        { ruleId: 'r5', type: 'keyword_block', action: 'warn', priority: 5, enabled: true, config: { keywords: ['bad'] }, description: '' },
      ]),
    ]);

    const result = await evaluator.evaluate(makeRequest('bad content'));
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });
});
