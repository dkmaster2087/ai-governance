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
    expect(patternProblem('([a-z')).toMatch(/isn’t a valid pattern/);
    expect(patternProblem('INV-[0-9{6')).toBe('isn’t a valid pattern: a [ has no closing ]');
    expect(patternProblem('*abc')).toBe('isn’t a valid pattern: *, + or ? has nothing before it to repeat');
    expect(patternProblem('')).toMatch(/empty/);
    expect(patternProblem('a'.repeat(501))).toMatch(/longer/);
    expect(patternProblem('(a+)+$')).toMatch(/slow/);
  });

  it('names the pattern itself, never an internal rule ID', () => {
    const problems = validatePolicyPatterns([{ ruleId: 'r9', type: 'data_classification', config: { patterns: ['ok', '(x+)+'] } }]);
    expect(problems).toEqual(['The pattern “(x+)+” could be very slow on some inputs (repetition inside repetition); simplify it.']);
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

describe('compliance routes', () => {
  it('returns 404 for frameworks that are not in v1', async () => {
    const { complianceRoutes } = await import('../routes/compliance.routes');
    const app = Fastify();
    await app.register(complianceRoutes, { prefix: '/v1/compliance' });
    const removed = await app.inject({ method: 'GET', url: '/v1/compliance/packs/gdpr' });
    expect(removed.statusCode).toBe(404);
    const kept = await app.inject({ method: 'GET', url: '/v1/compliance/packs/hipaa' });
    expect(kept.statusCode).toBe(200);
    await app.close();
  });
});
