import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:circuit-breaker');

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;    // Number of failures before opening
  resetTimeoutMs: number;      // Time to wait before trying again (half-open)
  halfOpenMaxAttempts: number;  // Successful calls needed to close again
}

/**
 * Circuit breaker pattern for external service calls.
 * Prevents cascading failures when a dependency is down.
 *
 * States:
 * - CLOSED: normal operation, requests pass through
 * - OPEN: service is down, requests fail fast without calling
 * - HALF-OPEN: testing if service recovered, limited requests allowed
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private options: CircuitBreakerOptions;

  constructor(options: CircuitBreakerOptions) {
    this.options = options;
  }

  getState(): CircuitState { return this.state; }
  getFailureCount(): number { return this.failureCount; }

  /**
   * Execute a function through the circuit breaker.
   * @param fn The async function to execute
   * @param fallback Optional fallback when circuit is open
   */
  async execute<T>(fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    if (this.state === 'open') {
      // Check if reset timeout has elapsed
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeoutMs) {
        this.state = 'half-open';
        this.successCount = 0;
        logger.info('Circuit half-open, testing recovery', { name: this.options.name });
      } else {
        // Fail fast
        if (fallback) return fallback();
        throw new CircuitOpenError(this.options.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.options.halfOpenMaxAttempts) {
        this.state = 'closed';
        this.failureCount = 0;
        logger.info('Circuit closed, service recovered', { name: this.options.name });
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.options.failureThreshold) {
      this.state = 'open';
      logger.warn('Circuit opened, service unavailable', {
        name: this.options.name,
        failures: this.failureCount,
        resetIn: this.options.resetTimeoutMs + 'ms',
      });
    }
  }

  /** Reset the circuit breaker to closed state */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
  }
}

export class CircuitOpenError extends Error {
  code = 'CIRCUIT_OPEN';
  statusCode = 503;
  constructor(serviceName: string) {
    super(`Circuit breaker open for ${serviceName} — service unavailable`);
  }
}
