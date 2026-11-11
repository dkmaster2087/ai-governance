import { NormalizedAIRequest, PolicyEvaluationResult } from '@ai-governance/types';
import { createLogger, GovernanceUnavailableError } from '@ai-governance/utils';
import { PolicyEvaluator } from '../policy/services/policy.evaluator';
import { metrics, METRIC } from '../services/metrics';

const logger = createLogger('gateway:policy');

/**
 * Check 1, company rules. Runs inside the gateway (it used to be a separate service). If the rules can't be
 * read, it throws GovernanceUnavailableError and the caller applies the company's fail mode.
 */
export class PolicyEngineClient {
  private evaluator = new PolicyEvaluator();

  async evaluate(request: NormalizedAIRequest): Promise<PolicyEvaluationResult> {
    const start = Date.now();
    try {
      const result = await this.evaluator.evaluate(request);
      metrics.recordHistogram(METRIC.POLICY_EVAL_LATENCY, Date.now() - start, { tenantId: request.tenantId });
      return result;
    } catch (err) {
      logger.error('Policy check failed', { error: (err as Error).message, requestId: request.requestId });
      metrics.increment(METRIC.PROVIDER_ERROR, { service: 'policy' });
      throw new GovernanceUnavailableError('policy-engine');
    }
  }
}
