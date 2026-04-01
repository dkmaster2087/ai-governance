import { estimateTokenCount, estimateCost } from '../tokens';

describe('estimateTokenCount', () => {
  it('estimates tokens at ~4 chars per token', () => {
    expect(estimateTokenCount('abcd')).toBe(1);
    expect(estimateTokenCount('abcdefgh')).toBe(2);
  });

  it('rounds up for partial tokens', () => {
    expect(estimateTokenCount('abc')).toBe(1);
    expect(estimateTokenCount('abcde')).toBe(2);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokenCount('')).toBe(0);
  });
});

describe('estimateCost', () => {
  it('calculates cost correctly', () => {
    // 1000 input tokens at $0.01/1k + 500 output tokens at $0.03/1k
    expect(estimateCost(1000, 500, 0.01, 0.03)).toBeCloseTo(0.025);
  });

  it('returns 0 for zero tokens', () => {
    expect(estimateCost(0, 0, 0.01, 0.03)).toBe(0);
  });
});
