import { OPS, OpsMetrics } from '../services/cloudwatch';

describe('operational metrics for CloudWatch', () => {
  it('writes one embedded-metric line a minute with counts and latencies, then starts over', () => {
    const lines: any[] = [];
    const m = new OpsMetrics('probaline/prod', (l) => lines.push(JSON.parse(l)));
    m.count(OPS.POLICY_VIOLATIONS);
    m.count(OPS.POLICY_VIOLATIONS);
    m.count(OPS.CIRCUIT_OPEN);
    for (const ms of [120, 121, 4_900, 5_100]) m.time(OPS.REQUEST_LATENCY, ms);
    m.flush(1_000);
    expect(lines[0]).toMatchObject({
      _aws: { Timestamp: 1_000, CloudWatchMetrics: [{ Namespace: 'probaline/prod', Dimensions: [[]], Metrics: [{ Name: 'PolicyViolations', Unit: 'Count' }, { Name: 'CircuitBreakerOpen', Unit: 'Count' }] }] },
      PolicyViolations: 2, CircuitBreakerOpen: 1,
    });
    expect(lines[1].RequestLatency).toEqual({ Values: [120, 4900, 5100], Counts: [2, 1, 1] });
    m.flush(2_000);
    expect(lines).toHaveLength(2);
  });

  it('records nothing without a namespace, and splits more than 100 distinct values', () => {
    const lines: string[] = [];
    const off = new OpsMetrics('', (l) => lines.push(l));
    off.count(OPS.POLICY_VIOLATIONS); off.flush();
    expect(lines).toEqual([]);
    const on = new OpsMetrics('ns', (l) => lines.push(l));
    for (let i = 0; i < 150; i++) on.time(OPS.REQUEST_LATENCY, i);
    on.flush();
    const parts = lines.map((l) => JSON.parse(l).RequestLatency);
    expect(parts.length).toBe(2);
    expect(parts.every((p) => p.Values.length <= 100)).toBe(true);
    expect(parts.flatMap((p) => p.Counts).reduce((a: number, b: number) => a + b, 0)).toBe(150);
  });
});
