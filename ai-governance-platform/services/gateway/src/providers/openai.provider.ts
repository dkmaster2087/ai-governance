import axios from 'axios';
import { NormalizedAIRequest, NormalizedAIResponse } from '@ai-governance/types';
import { ProviderError, createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:openai');

/** One piece of a streamed answer, in a provider-neutral shape. */
export interface StreamDelta {
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
}

/** Split a server-sent-events byte stream into `data:` payloads. */
export async function* sseData(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}

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

  /** Stream an answer. Errors before the first byte are thrown as ProviderError. */
  async *stream(request: NormalizedAIRequest, apiKey?: string, signal?: AbortSignal): AsyncGenerator<StreamDelta> {
    const key = apiKey || this.defaultApiKey;
    if (!key) throw new ProviderError('openai', 'No API key configured for this model. Add one in the model configuration.');
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.modelId, messages: request.messages, max_tokens: request.maxTokens, temperature: request.temperature,
          stream: true, stream_options: { include_usage: true },
        }),
        signal,
      });
    } catch (err) {
      throw new ProviderError('openai', (err as Error).message);
    }
    if (!res.ok || !res.body) {
      const detail = await res.json().catch(() => null) as any;
      logger.error('OpenAI stream failed', { status: res.status, modelId: request.modelId });
      throw new ProviderError('openai', detail?.error?.message || `HTTP ${res.status}`);
    }
    for await (const data of sseData(res.body as unknown as AsyncIterable<Uint8Array>)) {
      if (data === '[DONE]') return;
      let chunk: any;
      try { chunk = JSON.parse(data); } catch { continue; }
      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) yield { text: choice.delta.content };
      if (choice?.finish_reason) yield { finishReason: choice.finish_reason };
      if (chunk.usage) yield { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
    }
  }
}
