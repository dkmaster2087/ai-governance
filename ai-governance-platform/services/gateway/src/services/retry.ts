import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:retry');

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors?: string[];  // Error codes that should be retried
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 5000,
  retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN'],
};

/**
 * Retry with exponential backoff and jitter.
 * Only retries on transient/network errors, not on 4xx responses.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  context?: string
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      // Don't retry client errors (4xx)
      const status = err?.response?.status;
      if (status && status >= 400 && status < 500) throw err;

      // Don't retry if error code is not retryable
      const code = err?.code || err?.cause?.code;
      if (code && opts.retryableErrors && !opts.retryableErrors.includes(code)) throw err;

      // Don't retry on last attempt
      if (attempt === opts.maxAttempts) break;

      // Exponential backoff with jitter
      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100,
        opts.maxDelayMs
      );

      logger.warn('Retrying after failure', {
        attempt,
        maxAttempts: opts.maxAttempts,
        delayMs: Math.round(delay),
        error: err.message,
        context,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
