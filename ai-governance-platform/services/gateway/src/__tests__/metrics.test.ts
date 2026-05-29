import { metrics, METRIC } from '../services/metrics';

describe('MetricsCollector', () => {
  beforeEach(() => {
    metrics.reset();
  });

  describe('counters', () => {
    it('increments a counter', () => {
      metrics.increment('test.count');
      metrics.increment('test.count');
      const snapshot = metrics.getSnapshot();
      expect(snapshot.counters['test.count']).toBe(2);
    });

    it('supports dimensions', () => {
      metrics.increment('requests', { tenantId: 'a' });
      metrics.increment('requests', { tenantId: 'b' });
      metrics.increment('requests', { tenantId: 'a' });
      const snapshot = metrics.getSnapshot();
      expect(snapshot.counters['requests|tenantId=a']).toBe(2);
      expect(snapshot.counters['requests|tenantId=b']).toBe(1);
    });
  });

  describe('histograms', () => {
    it('records values and computes percentiles', () => {
      for (let i = 1; i <= 100; i++) {
        metrics.recordHistogram('latency', i);
      }
      const snapshot = metrics.getSnapshot();
      expect(snapshot.histograms['latency'].count).toBe(100);
      expect(snapshot.histograms['latency'].avg).toBeGreaterThanOrEqual(50);
      expect(snapshot.histograms['latency'].avg).toBeLessThanOrEqual(51);
      expect(snapshot.histograms['latency'].p50).toBeGreaterThanOrEqual(49);
      expect(snapshot.histograms['latency'].p95).toBeGreaterThanOrEqual(94);
      expect(snapshot.histograms['latency'].max).toBe(100);
    });
  });

  describe('gauges', () => {
    it('sets and overwrites gauge values', () => {
      metrics.setGauge('connections', 5);
      metrics.setGauge('connections', 10);
      const snapshot = metrics.getSnapshot();
      expect(snapshot.gauges['connections']).toBe(10);
    });
  });

  describe('reset', () => {
    it('clears all metrics', () => {
      metrics.increment('a');
      metrics.recordHistogram('b', 100);
      metrics.setGauge('c', 5);
      metrics.reset();
      const snapshot = metrics.getSnapshot();
      expect(Object.keys(snapshot.counters)).toHaveLength(0);
      expect(Object.keys(snapshot.histograms)).toHaveLength(0);
      expect(Object.keys(snapshot.gauges)).toHaveLength(0);
    });
  });

  describe('METRIC constants', () => {
    it('has all expected metric names', () => {
      expect(METRIC.REQUEST_COUNT).toBe('requests.total');
      expect(METRIC.REQUEST_LATENCY).toBe('requests.latency_ms');
      expect(METRIC.CIRCUIT_OPEN).toBe('circuit_breaker.open');
    });
  });
});
