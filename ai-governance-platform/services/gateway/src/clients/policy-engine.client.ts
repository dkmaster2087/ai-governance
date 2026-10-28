import axios from 'axios';
import { NormalizedAIRequest, PolicyEvaluationResult } from '@ai-governance/types';
import { createLogger, GovernanceUnavailableError } from '@ai-governance/utils';
import { CircuitBreaker } from '../services/circuit-breaker';
import { withRetry } from '../services/retry';
import { metrics, METRIC } from '../services/metrics';

const logger = createLogger('gateway:policy-client');

export class PolicyEngineClient {
  private baseUrl = process.env.POLICY_ENGINE_URL || 'http://policy-engine:3001';
  private circuitBreaker = new CircuitBreaker({
    name: 'policy-engine',
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    halfOpenMaxAttempts: 2,
  });

  /**
   * Ask the policy engine for a decision. Throws GovernanceUnavailableError if it can't be reached;
   * the caller decides whether to block or continue based on the tenant's fail mode.
   */
  async evaluate(request: NormalizedAIRequest): Promise<PolicyEvaluationResult> {
    const start = Date.now();
    try {
      const result = await this.circuitBreaker.execute(() =>
        withRetry(
          () => axios.post<PolicyEvaluationResult>(
            `${this.baseUrl}/v1/evaluate`,
            request,
            { timeout: 5000 }
          ).then((r) => r.data),
          { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 1000 },
          'policy-evaluate'
        )
      );
      metrics.recordHistogram(METRIC.POLICY_EVAL_LATENCY, Date.now() - start, { tenantId: request.tenantId });
      return result;
    } catch (err: any) {
      logger.error('Policy engine call failed', { error: err.message, requestId: request.requestId });
      metrics.increment(METRIC.PROVIDER_ERROR, { service: 'policy-engine' });
      throw new GovernanceUnavailableError('policy-engine');
    }
  }

  /** Get circuit breaker state (for health checks) */
  getCircuitState() {
    return this.circuitBreaker.getState();
  }
}
