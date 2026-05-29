import { CircuitBreaker, CircuitOpenError } from '../services/circuit-breaker';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({
      name: 'test-service',
      failureThreshold: 3,
      resetTimeoutMs: 100,
      halfOpenMaxAttempts: 2,
    });
  });

  it('starts in closed state', () => {
    expect(cb.getState()).toBe('closed');
  });

  it('passes through successful calls', async () => {
    const result = await cb.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(cb.getState()).toBe('closed');
  });

  it('opens after reaching failure threshold', async () => {
    const fail = () => Promise.reject(new Error('fail'));

    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();

    expect(cb.getState()).toBe('open');
  });

  it('fails fast when open (no fallback)', async () => {
    // Force open
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }

    await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow(CircuitOpenError);
  });

  it('uses fallback when open', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }

    const result = await cb.execute(() => Promise.resolve('ok'), () => 'fallback');
    expect(result).toBe('fallback');
  });

  it('transitions to half-open after reset timeout', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(cb.getState()).toBe('open');

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 150));

    // Next call should go through (half-open)
    const result = await cb.execute(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
    expect(cb.getState()).toBe('half-open');
  });

  it('closes after enough successes in half-open', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }

    await new Promise((r) => setTimeout(r, 150));

    // Two successes needed to close
    await cb.execute(() => Promise.resolve('ok'));
    await cb.execute(() => Promise.resolve('ok'));

    expect(cb.getState()).toBe('closed');
  });

  it('resets failure count on success in closed state', async () => {
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    // 2 failures, not yet open

    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getFailureCount()).toBe(0);
    expect(cb.getState()).toBe('closed');
  });

  it('reset() returns to closed state', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(cb.getState()).toBe('open');

    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.getFailureCount()).toBe(0);
  });
});
