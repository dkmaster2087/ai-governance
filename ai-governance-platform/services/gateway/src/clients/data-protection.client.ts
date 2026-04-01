import axios from 'axios';
import { NormalizedAIRequest, NormalizedAIResponse } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:data-protection-client');

export class DataProtectionClient {
  private baseUrl = process.env.DATA_PROTECTION_URL || 'http://data-protection:3002';

  async protectRequest(request: NormalizedAIRequest): Promise<NormalizedAIRequest> {
    try {
      const response = await axios.post<NormalizedAIRequest>(
        `${this.baseUrl}/v1/protect/request`,
        request,
        { timeout: 5000 }
      );
      return response.data;
    } catch (err) {
      logger.warn('Data protection service unavailable, proceeding without masking', {
        requestId: request.requestId,
      });
      return request;
    }
  }

  async filterResponse(response: NormalizedAIResponse): Promise<NormalizedAIResponse> {
    try {
      const result = await axios.post<NormalizedAIResponse>(
        `${this.baseUrl}/v1/protect/response`,
        response,
        { timeout: 5000 }
      );
      return result.data;
    } catch (err) {
      logger.warn('Response filtering unavailable', { requestId: response.requestId });
      return response;
    }
  }
}
