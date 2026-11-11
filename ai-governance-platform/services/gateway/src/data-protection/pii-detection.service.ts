import {
  ComprehendClient,
  DetectPiiEntitiesCommand,
  PiiEntityType,
} from '@aws-sdk/client-comprehend';
import { NormalizedAIRequest, NormalizedAIResponse } from '@ai-governance/types';
import { maskPII, createLogger } from '@ai-governance/utils';

const logger = createLogger('data-protection:pii');

const MASK_PLACEHOLDER = '[REDACTED]';

export class PIIDetectionService {
  private comprehend = new ComprehendClient({ region: process.env.AWS_REGION || 'us-east-1' });

  async protectRequest(request: NormalizedAIRequest): Promise<NormalizedAIRequest> {
    const maskedMessages = await Promise.all(
      request.messages.map(async (msg) => {
        if (msg.role === 'user' || msg.role === 'system') {
          const masked = await this.maskText(msg.content);
          return { ...msg, content: masked };
        }
        return msg;
      })
    );

    return { ...request, messages: maskedMessages };
  }

  async filterResponse(response: NormalizedAIResponse): Promise<NormalizedAIResponse> {
    const maskedContent = await this.maskText(response.content);
    return { ...response, content: maskedContent };
  }

  private async maskText(text: string): Promise<string> {
    // First apply regex-based masking (fast, no API cost)
    let masked = maskPII(text, MASK_PLACEHOLDER);

    // Then use Comprehend for deeper detection if enabled
    if (process.env.COMPREHEND_ENABLED === 'true') {
      try {
        masked = await this.comprehendMask(masked);
      } catch (err) {
        logger.warn('Comprehend PII detection failed, using regex only', { error: err });
      }
    }

    return masked;
  }

  private async comprehendMask(text: string): Promise<string> {
    // Comprehend has a 5000 byte limit per request
    if (Buffer.byteLength(text) > 4900) {
      return text;
    }

    const result = await this.comprehend.send(
      new DetectPiiEntitiesCommand({ Text: text, LanguageCode: 'en' })
    );

    if (!result.Entities || result.Entities.length === 0) return text;

    // Replace from end to start to preserve offsets
    let masked = text;
    const sorted = [...result.Entities].sort((a, b) => (b.BeginOffset || 0) - (a.BeginOffset || 0));

    for (const entity of sorted) {
      if (entity.BeginOffset !== undefined && entity.EndOffset !== undefined) {
        masked =
          masked.slice(0, entity.BeginOffset) +
          `[${entity.Type as PiiEntityType}]` +
          masked.slice(entity.EndOffset);
      }
    }

    return masked;
  }
}
