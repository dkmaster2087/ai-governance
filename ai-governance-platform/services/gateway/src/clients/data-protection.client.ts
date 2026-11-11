import { NormalizedAIRequest, NormalizedAIResponse } from '@ai-governance/types';
import { createLogger, GovernanceUnavailableError } from '@ai-governance/utils';
import { PIIDetectionService } from '../data-protection/pii-detection.service';

const logger = createLogger('gateway:data-protection');

/**
 * Check 3, personal data. Runs inside the gateway (it used to be a separate service). A failure (for example
 * Comprehend unreachable when it's turned on) throws GovernanceUnavailableError, and the caller applies the
 * company's fail mode.
 */
export class DataProtectionClient {
  private pii = new PIIDetectionService();

  async protectRequest(request: NormalizedAIRequest): Promise<NormalizedAIRequest> {
    try {
      return await this.pii.protectRequest(request);
    } catch (err) {
      logger.error('Personal data check failed', { requestId: request.requestId, error: (err as Error).message });
      throw new GovernanceUnavailableError('data-protection');
    }
  }

  async filterResponse(response: NormalizedAIResponse, _tenantId: string): Promise<NormalizedAIResponse> {
    try {
      return await this.pii.filterResponse(response);
    } catch (err) {
      logger.error('Response filtering failed', { requestId: response.requestId, error: (err as Error).message });
      throw new GovernanceUnavailableError('data-protection');
    }
  }
}
