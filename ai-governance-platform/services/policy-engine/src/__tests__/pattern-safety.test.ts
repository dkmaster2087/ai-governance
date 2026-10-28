import Fastify from 'fastify';
import { PolicyEvaluator } from '../services/policy.evaluator';
import { PolicyRepository } from '../repositories/policy.repository';
import { patternProblem, validatePolicyPatterns } from '../services/pattern-safety';
import { NormalizedAIRequest, Policy, PolicyRule } from '@ai-governance/types';

jest.mock('../repositories/policy.repository');
jest.mock('../compliance/compliance.service');
const MockRepo = PolicyRepository as jest.MockedClass<typeof PolicyRepository>;

const request = (content: string): NormalizedAIRequest => ({
  requestId: 'r', tenantId: 't', userId: 'u', appId: 'a', provider: 'bedrock', modelId: 'm',
  messages: [{ role: 'user', content }], metadata: {}, timestamp: '',
});
const policyWith = (rule: Partial<PolicyRule>): Policy => ({
  policyId: 'p', tenantId: 't', name: 'n', description: '', enabled: true, createdAt: '', updatedAt: '', createdBy: 'x',
  rules: [{ ruleId: 'r1', type: 'data_classification', action: 'block', priority: 1, enabled: true, config: {}, description: 'blocked', ...rule } as PolicyRule],
});

describe('pattern safety', () => {
  it('accepts normal patterns', () => {
    expect(patternProblem('project\\s+(phoenix|atlas)')).toBeNull();
  });

  it('rejects invalid, empty, oversized and catastrophic patterns', () => {
    expect(patternProblem('([a-z')).toMatch(/Invalid/);
    expect(patternProblem('')).toMatch(/non-empty/);
    expect(patternProblem('a'.repeat(501))).toMatch(/longer/);
    expect(patternProblem('(a+)+$')).toMatch(/slow/);
  });

  it('reports problems per rule', () => {
    const problems = validatePolicyPatterns([{ ruleId: 'r9', type: 'data_classification', config: { patterns: ['ok', '(x+)+'] } }]);
    expect(problems).toEqual([expect.stringContaining('Rule r9, pattern 2')]);
  });
});

describe('PolicyEvaluator with tenant patterns', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips a broken pattern instead of failing the whole evaluation', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue([policyWith({ config: { patterns: ['([unclosed', 'codename-\\d+'] } })]);
    const result = await new PolicyEvaluator().evaluate(request('ship codename-42 today'));
    expect(result.allowed).toBe(false);
  });

  it('ignores catastrophic patterns', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue([policyWith({ config: { patterns: ['(a+)+$'] } })]);
    const start = Date.now();
    const result = await new PolicyEvaluator().evaluate(request('a'.repeat(40) + '!'));
    expect(result.allowed).toBe(true);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('matches case-sensitive PII types such as names', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue([policyWith({ type: 'pii_detection', config: { piiTypes: ['NAME'] } })]);
    const result = await new PolicyEvaluator().evaluate(request('Write a letter to Jane Smith'));
    expect(result.allowed).toBe(false);
  });
});

describe('policy routes', () => {
  it('rejects policies with unsafe patterns', async () => {
    const { policyRoutes } = await import('../routes/policy.routes');
    const app = Fastify();
    await app.register(policyRoutes, { prefix: '/v1/policies' });
    const res = await app.inject({
      method: 'POST', url: '/v1/policies',
      payload: { tenantId: 't', name: 'x', rules: [{ ruleId: 'r1', type: 'data_classification', config: { patterns: ['(a+)+'] } }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_RULES');
    expect(MockRepo.prototype.createPolicy).not.toHaveBeenCalled();
    await app.close();
  });
});
