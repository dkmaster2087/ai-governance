import axios from 'axios';
import { NormalizedAIRequest, NormalizedAIResponse } from '@ai-governance/types';
import { ProviderError, createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:openai');

export class OpenAIProvider {
  private baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  private apiKey = process.env.OPENAI_API_KEY || '';

  async complete(request: NormalizedAIRequest): Promise<NormalizedAIResponse> {
    const start = Date.now();

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: request.modelId,
          messages: request.messages,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const data = response.data;
      return {
        requestId: request.requestId,
        provider: 'openai',
        modelId: request.modelId,
        content: data.choices?.[0]?.message?.content || '',
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        latencyMs: Date.now() - start,
        finishReason: data.choices?.[0]?.finish_reason || 'stop',
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      logger.error('OpenAI invocation failed', { error: err, modelId: request.modelId });
      throw new ProviderError('openai', (err as Error).message);
    }
  }
}
