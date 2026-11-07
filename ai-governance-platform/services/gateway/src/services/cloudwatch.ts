/**
 * The operational metrics the CloudWatch alarms watch, published once a minute as CloudWatch embedded
 * metric format: one JSON line on stdout, which CloudWatch Logs turns into metrics. No AWS calls or
 * permissions needed. Off unless METRICS_NAMESPACE is set (the AWS deployment sets it).
 */

export const OPS = {
  /** AI requests and tool calls stopped by a rule. */
  POLICY_VIOLATIONS: 'PolicyViolations',
  /** Time to answer an AI request or tool call, end to end. */
  REQUEST_LATENCY: 'RequestLatency',
  /** A dependency (policy engine, a provider) stopped being called after repeated failures. */
  CIRCUIT_OPEN: 'CircuitBreakerOpen',
} as const;

type Name = (typeof OPS)[keyof typeof OPS];
const UNITS: Record<Name, 'Count' | 'Milliseconds'> = { PolicyViolations: 'Count', RequestLatency: 'Milliseconds', CircuitBreakerOpen: 'Count' };

/** Keep at most two significant digits, so a minute of latencies fits in few distinct values. */
const bucket = (ms: number) => {
  if (ms < 10) return Math.max(0, Math.round(ms));
  const p = 10 ** (Math.floor(Math.log10(ms)) - 1);
  return Math.round(ms / p) * p;
};

export class OpsMetrics {
  private counts = new Map<Name, number>();
  private timings = new Map<Name, Map<number, number>>();

  constructor(private namespace = process.env.METRICS_NAMESPACE ?? '', private write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)) {}

  get enabled() { return this.namespace !== ''; }

  count(name: Name, n = 1) {
    if (this.enabled) this.counts.set(name, (this.counts.get(name) ?? 0) + n);
  }

  time(name: Name, ms: number) {
    if (!this.enabled || !Number.isFinite(ms)) return;
    const t = this.timings.get(name) ?? new Map<number, number>();
    const b = bucket(ms);
    t.set(b, (t.get(b) ?? 0) + 1);
    this.timings.set(name, t);
  }

  /** Write what was recorded since the last flush; nothing when nothing happened. */
  flush(now = Date.now()) {
    const line = (values: Record<string, unknown>) => {
      const names = Object.keys(values) as Name[];
      this.write(JSON.stringify({
        _aws: { Timestamp: now, CloudWatchMetrics: [{ Namespace: this.namespace, Dimensions: [[]], Metrics: names.map((Name) => ({ Name, Unit: UNITS[Name] })) }] },
        ...values,
      }));
    };
    if (this.counts.size) line(Object.fromEntries(this.counts));
    for (const [name, t] of this.timings) {
      // At most 100 distinct values per line.
      const entries = [...t];
      for (let i = 0; i < entries.length; i += 100) {
        const chunk = entries.slice(i, i + 100);
        line({ [name]: { Values: chunk.map(([v]) => v), Counts: chunk.map(([, c]) => c) } });
      }
    }
    this.counts.clear();
    this.timings.clear();
  }

  start(): NodeJS.Timeout | null {
    if (!this.enabled) return null;
    const timer = setInterval(() => this.flush(), 60_000);
    timer.unref();
    return timer;
  }
}

export const opsMetrics = new OpsMetrics();
