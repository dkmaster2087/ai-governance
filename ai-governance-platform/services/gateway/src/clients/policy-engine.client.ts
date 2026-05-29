import axios from 'axios';
import { NormalizedAIRequest, PolicyEvaluationResult } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
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

  async evaluate(request: NormalizedAIRequest): Promise<PolicyEvaluationResult> {
    const start = Date.now();

    try {
      const result = await this.circuitBreaker.execute(
        () => withRetry(
          () => axios.post<PolicyEvaluationResult>(
            `${this.baseUrl}/v1/evaluate`,
            request,
            { timeout: 5000 }
          ).then((r) => r.data),
          { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 1000 },
          'policy-evaluate'
        ),
        // Fallback when circuit is open — fail open with warning
        () => ({
          allowed: true,
          action: 'allow' as const,
          triggeredRules: [],
          riskScore: 0,
          reason: 'Policy engine unavailable (circuit open) - fail open',
        })
      );

      metrics.recordHistogram(METRIC.POLICY_EVAL_LATENCY, Date.now() - start, { tenantId: request.tenantId });
      return result;
    } catch (err: any) {
      logger.error('Policy engine call failed', { error: err.message, requestId: request.requestId });
      metrics.increment(METRIC.PROVIDER_ERROR, { service: 'policy-engine' });

      // Fail open with warning — configurable per tenant in production
      return {
        allowed: true,
        action: 'allow',
        triggeredRules: [],
        riskScore: 0,
        reason: 'Policy engine unavailable - fail open',
      };
    }
  }

  /** Get circuit breaker state (for health checks) */
  getCircuitState() {
    return this.circuitBreaker.getState();
  }
}
