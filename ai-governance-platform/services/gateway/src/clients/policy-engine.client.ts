import axios from 'axios';
import { NormalizedAIRequest, PolicyEvaluationResult } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:policy-client');

export class PolicyEngineClient {
  private baseUrl = process.env.POLICY_ENGINE_URL || 'http://policy-engine:3001';

  async evaluate(request: NormalizedAIRequest): Promise<PolicyEvaluationResult> {
    try {
      const response = await axios.post<PolicyEvaluationResult>(
        `${this.baseUrl}/v1/evaluate`,
        request,
        { timeout: 5000 }
      );
      return response.data;
    } catch (err) {
      logger.error('Policy engine call failed', { error: err, requestId: request.requestId });
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
}
