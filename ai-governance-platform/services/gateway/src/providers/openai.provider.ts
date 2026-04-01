import axios from 'axios';
import { NormalizedAIRequest, NormalizedAIResponse } from '@ai-governance/types';
import { ProviderError, createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:openai');

export class OpenAIProvider {
  private baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  private defaultApiKey = process.env.OPENAI_API_KEY || '';

  async complete(request: NormalizedAIRequest, apiKey?: string): Promise<NormalizedAIResponse> {
    const key = apiKey || this.defaultApiKey;
    if (!key) {
      throw new ProviderError('openai', 'No API key configured for this model. Add one in the model configuration.');
    }

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
            Authorization: `Bearer ${key}`,
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
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err.message;
      logger.error('OpenAI invocation failed', { error: msg, modelId: request.modelId });
      throw new ProviderError('openai', msg);
    }
  }
}
