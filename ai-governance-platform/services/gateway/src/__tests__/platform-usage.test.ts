import { AuditLog } from '@ai-governance/types';
import { localDate, summarizePlatform } from '../services/platform-usage';

const log = (over: Partial<AuditLog>): AuditLog => ({
  logId: 'l', requestId: 'r', tenantId: 't', userId: 'u', appId: 'a', eventType: 'request_completed' as AuditLog['eventType'],
  provider: 'bedrock', modelId: 'm1', promptHash: '', responseHash: '', policyDecision: 'allow', triggeredRules: [],
  piiDetected: false, piiTypes: [], inputTokens: 0, outputTokens: 0, estimatedCost: 0.01, latencyMs: 1,
  timestamp: '2026-10-20T12:00:00.000Z', metadata: {}, ...over,
});

describe('summarizePlatform', () => {
  const range = { from: '2026-10-18T00:00:00.000Z', to: '2026-10-21T00:00:00.000Z', tz: 0 };

  it('counts requests, stops, cleaned and cost per tenant and in total', () => {
    const usage = summarizePlatform([
      { tenantId: 'a', truncated: false, logs: [log({}), log({ eventType: 'request_blocked' as AuditLog['eventType'], estimatedCost: 0 }), log({ piiDetected: true })] },
      { tenantId: 'b', truncated: true, logs: [log({ modelId: 'm2', timestamp: '2026-10-19T08:00:00.000Z' })] },
      { tenantId: 'quiet', truncated: false, logs: [] },
    ], range);
    expect(usage.totals).toEqual({ requests: 4, stopped: 1, cleaned: 1, cost: expect.closeTo(0.03) });
    expect(usage.tenants.map((t) => t.tenantId)).toEqual(['a', 'b', 'quiet']);
    expect(usage.tenants[0]).toMatchObject({ requests: 3, stopped: 1, cleaned: 1, lastRequestAt: '2026-10-20T12:00:00.000Z' });
    expect(usage.tenants[2]).toMatchObject({ requests: 0, lastRequestAt: null });
    expect(usage.truncated).toBe(true);
  });

  it('lists every day in the range, including quiet ones', () => {
    const usage = summarizePlatform([{ tenantId: 'a', truncated: false, logs: [log({}), log({ eventType: 'request_blocked' as AuditLog['eventType'] })] }], range);
    expect(usage.days.map((d) => d.date)).toEqual(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']);
    expect(usage.days[2]).toEqual({ date: '2026-10-20', requests: 2, stopped: 1 });
    expect(usage.days[0].requests).toBe(0);
  });

  it('groups days in the viewer’s timezone', () => {
    // 03:00 UTC is still the previous evening in Denver (UTC-6, offset +360).
    expect(localDate('2026-10-20T03:00:00.000Z', 360)).toBe('2026-10-19');
  });
});
