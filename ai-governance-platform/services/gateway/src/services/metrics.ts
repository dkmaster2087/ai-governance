import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:metrics');

/**
 * In-memory metrics collector.
 * In production, these would be pushed to CloudWatch Metrics or Prometheus.
 */
export interface MetricPoint {
  name: string;
  value: number;
  unit: 'count' | 'milliseconds' | 'bytes' | 'percent';
  dimensions: Record<string, string>;
  timestamp: number;
}

class MetricsCollector {
  private counters = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private gauges = new Map<string, number>();

  /** Increment a counter */
  increment(name: string, dimensions: Record<string, string> = {}, value = 1): void {
    const key = this.makeKey(name, dimensions);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  /** Record a histogram value (e.g., latency) */
  recordHistogram(name: string, value: number, dimensions: Record<string, string> = {}): void {
    const key = this.makeKey(name, dimensions);
    const values = this.histograms.get(key) || [];
    values.push(value);
    // Keep last 1000 values
    if (values.length > 1000) values.shift();
    this.histograms.set(key, values);
  }

  /** Set a gauge value */
  setGauge(name: string, value: number, dimensions: Record<string, string> = {}): void {
    const key = this.makeKey(name, dimensions);
    this.gauges.set(key, value);
  }

  /** Get current metrics snapshot */
  getSnapshot(): {
    counters: Record<string, number>;
    histograms: Record<string, { count: number; avg: number; p50: number; p95: number; p99: number; max: number }>;
    gauges: Record<string, number>;
  } {
    const histogramStats: Record<string, any> = {};
    for (const [key, values] of this.histograms.entries()) {
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      histogramStats[key] = {
        count: sorted.length,
        avg: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
        max: sorted[sorted.length - 1],
      };
    }

    return {
      counters: Object.fromEntries(this.counters),
      histograms: histogramStats,
      gauges: Object.fromEntries(this.gauges),
    };
  }

  /** Reset all metrics (for testing or periodic flush) */
  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }

  private makeKey(name: string, dimensions: Record<string, string>): string {
    const dimStr = Object.entries(dimensions).sort().map(([k, v]) => `${k}=${v}`).join(',');
    return dimStr ? `${name}|${dimStr}` : name;
  }
}

// Singleton
export const metrics = new MetricsCollector();

// Pre-defined metric names
export const METRIC = {
  REQUEST_COUNT: 'requests.total',
  REQUEST_LATENCY: 'requests.latency_ms',
  REQUEST_BLOCKED: 'requests.blocked',
  REQUEST_ALLOWED: 'requests.allowed',
  POLICY_EVAL_LATENCY: 'policy.eval_latency_ms',
  PII_DETECTED: 'pii.detected',
  PROVIDER_LATENCY: 'provider.latency_ms',
  PROVIDER_ERROR: 'provider.errors',
  CIRCUIT_OPEN: 'circuit_breaker.open',
  API_KEY_VALIDATED: 'auth.key_validated',
  API_KEY_REJECTED: 'auth.key_rejected',
};
