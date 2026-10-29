import { AuditLog } from '@ai-governance/types';
import { localDate, summarizeStopped } from '../services/stopped-summary';

let n = 0;
function log(partial: Partial<AuditLog>): AuditLog {
  n++;
  return {
    logId: `l${n}`, requestId: `r${n}`, tenantId: 't', userId: 'u1', appId: 'billing-api', eventType: 'request_blocked',
    provider: 'openai', modelId: 'gpt-4o', promptHash: '', responseHash: '', policyDecision: 'block',
    triggeredRules: ['rule_kw'], piiDetected: false, piiTypes: [], inputTokens: 0, outputTokens: 0, estimatedCost: 0, latencyMs: 0,
    timestamp: '2026-10-27T15:00:00.000Z', metadata: { policyReason: 'Block confidential keywords' }, ...partial,
  };
}

describe('summarizeStopped', () => {
  const logs = [
    log({ userId: 'j.patel', timestamp: '2026-10-27T15:00:00.000Z', metadata: { policyReason: 'Block confidential keywords', ruleType: 'keyword_block', evidenceBefore: 'Summarise the ', evidenceHit: 'confidential', evidenceAfter: ' memo' } }),
    log({ userId: 'm.chen', appId: 'sales-copilot', timestamp: '2026-10-26T09:00:00.000Z' }),
    log({ userId: 'j.patel', timestamp: '2026-10-25T09:00:00.000Z', metadata: {} }),
    log({ triggeredRules: ['rule_models'], metadata: { policyReason: 'Approved models only' }, appId: 'analytics-etl', timestamp: '2026-10-27T01:00:00.000Z' }),
    log({ eventType: 'request_allowed', policyDecision: 'allow', triggeredRules: [] }),
  ];
  const s = summarizeStopped(logs, { from: '2026-10-24T06:00:00.000Z', to: '2026-10-28T06:00:00.000Z' });

  it('counts only stopped requests', () => {
    expect(s.total).toBe(4);
    expect(s.byCheck.policy).toBe(4);
    expect(s.byCheck.secrets.active).toBe(false);
  });

  it('groups by the stopping rule, largest first', () => {
    expect(s.causes.map((c) => [c.key, c.count])).toEqual([['rule_kw', 3], ['rule_models', 1]]);
    const kw = s.causes[0];
    expect(kw.reason).toBe('Block confidential keywords');
    expect(kw.people).toBe(2);
    expect(kw.topPeople[0]).toBe('j.patel');
    expect(kw.apps).toEqual([{ name: 'billing-api', count: 2 }, { name: 'sales-copilot', count: 1 }]);
  });

  it('shows the newest excerpt it has', () => {
    expect(s.causes[0].latest.evidence).toEqual({ before: 'Summarise the ', hit: 'confidential', after: ' memo' });
    expect(s.causes[1].latest.evidence).toBeUndefined();
  });

  it('has one bar per day, including quiet days', () => {
    expect(s.byDay.map((d) => d.date)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
    expect(s.byDay.map((d) => d.count)).toEqual([0, 1, 1, 2, 0]);
  });

  it('credits the stop to the last matched rule, not an earlier flag-only one', () => {
    const s2 = summarizeStopped([log({ triggeredRules: ['rule_flag', 'rule_stop'] })], { from: '2026-10-27T00:00:00Z', to: '2026-10-28T00:00:00Z' });
    expect(s2.causes[0].key).toBe('rule_stop');
  });

  it('buckets days in the viewer’s timezone', () => {
    // 01:00 UTC on the 27th is still the 26th in UTC-6 (offset +360 minutes).
    expect(localDate('2026-10-27T01:00:00.000Z', 360)).toBe('2026-10-26');
    expect(localDate('2026-10-27T01:00:00.000Z', 0)).toBe('2026-10-27');
  });
});
