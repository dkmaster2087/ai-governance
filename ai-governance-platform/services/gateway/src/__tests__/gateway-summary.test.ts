import { AuditLog } from '@ai-governance/types';
import { summarizeGatewayTraffic } from '../services/gateway-summary';

let n = 0;
function log(partial: Partial<AuditLog>): AuditLog {
  n++;
  return {
    logId: `l${n}`, requestId: `r${n}`, tenantId: 't', userId: 'u1', appId: 'support-bot', eventType: 'request_allowed',
    provider: 'bedrock', modelId: 'anthropic.claude-3-haiku', promptHash: '', responseHash: '', policyDecision: 'allow',
    triggeredRules: [], piiDetected: false, piiTypes: [], inputTokens: 0, outputTokens: 0, estimatedCost: 0, latencyMs: 0,
    timestamp: `2026-10-27T10:00:${String(n).padStart(2, '0')}.000Z`, metadata: {}, ...partial,
  };
}

describe('summarizeGatewayTraffic', () => {
  const logs = [
    log({}),
    log({ piiDetected: true }),
    log({ appId: 'billing-api', provider: 'openai', modelId: 'gpt-4o' }),
    log({ appId: 'billing-api', eventType: 'request_blocked', policyDecision: 'block', triggeredRules: ['rule_kw'], metadata: { policyReason: 'Block confidential keywords' } }),
    log({ appId: 'billing-api', eventType: 'request_blocked', policyDecision: 'block', triggeredRules: ['rule_kw'], metadata: { policyReason: 'Block confidential keywords' } }),
  ];
  const s = summarizeGatewayTraffic(logs, { from: 'a', to: 'b' }, [{ userId: 'alice' }, { userId: 'bob' }, { userId: 'alice' }]);

  it('adds up: received = stopped + delivered', () => {
    expect(s.received).toBe(5);
    expect(s.stopped).toBe(2);
    expect(s.delivered).toBe(3);
    expect(s.cleaned).toBe(1);
  });

  it('attributes stops to the policy check while secrets detection is not active', () => {
    expect(s.checks.policy.stopped).toBe(2);
    expect(s.checks.secrets).toEqual({ active: false, stopped: 0 });
    expect(s.checks.personalData.cleaned).toBe(1);
  });

  it('groups sources and delivered providers', () => {
    expect(s.sources).toEqual([{ name: 'billing-api', count: 3 }, { name: 'support-bot', count: 2 }]);
    expect(s.providers).toEqual([{ name: 'Amazon Bedrock', count: 2 }, { name: 'OpenAI', count: 1 }]);
  });

  it('uses the human-readable stop reason', () => {
    expect(s.topStopReasons).toEqual([{ reason: 'Block confidential keywords', count: 2 }]);
  });

  it('lists recent events newest first with outcomes', () => {
    expect(s.recent[0].outcome).toBe('stopped');
    expect(s.recent[0].reason).toBe('Block confidential keywords');
    expect(s.recent.map((r) => r.outcome)).toContain('cleaned');
  });

  it('counts shadow AI people and visits', () => {
    expect(s.shadowAi).toEqual({ people: 2, visits: 3 });
  });

  it('folds long tails of apps into one entry', () => {
    const many = Array.from({ length: 9 }, (_, i) => log({ appId: `app-${i}` }));
    const sum = summarizeGatewayTraffic(many, { from: 'a', to: 'b' });
    expect(sum.sources).toHaveLength(7);
    expect(sum.sources[6]).toEqual({ name: '3 other apps', count: 3 });
  });
});
