import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { NormalizedAIRequest, NormalizedAIResponse } from '@ai-governance/types';
import { ProviderError, createLogger } from '@ai-governance/utils';
import type { StreamDelta } from './openai.provider';

const logger = createLogger('gateway:bedrock');

export class BedrockProvider {
  private client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

  async complete(request: NormalizedAIRequest): Promise<NormalizedAIResponse> {
    const start = Date.now();

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: request.maxTokens || 1024,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    };

    try {
      const command = new InvokeModelCommand({
        modelId: request.modelId,
        body: JSON.stringify(payload),
        contentType: 'application/json',
        accept: 'application/json',
      });

      const raw = await this.client.send(command);
      const body = JSON.parse(new TextDecoder().decode(raw.body));

      return {
        requestId: request.requestId,
        provider: 'bedrock',
        modelId: request.modelId,
        content: body.content?.[0]?.text || '',
        inputTokens: body.usage?.input_tokens || 0,
        outputTokens: body.usage?.output_tokens || 0,
        latencyMs: Date.now() - start,
        finishReason: body.stop_reason || 'stop',
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      logger.error('Bedrock invocation failed', { error: err, modelId: request.modelId });
      throw new ProviderError('bedrock', (err as Error).message);
    }
  }

  /** Stream an answer from an Anthropic model on Bedrock. */
  async *stream(request: NormalizedAIRequest, signal?: AbortSignal): AsyncGenerator<StreamDelta> {
    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: request.maxTokens || 1024,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    let body;
    try {
      const res = await this.client.send(new InvokeModelWithResponseStreamCommand({
        modelId: request.modelId, body: JSON.stringify(payload), contentType: 'application/json', accept: 'application/json',
      }), { abortSignal: signal });
      body = res.body;
    } catch (err) {
      logger.error('Bedrock stream failed', { error: err, modelId: request.modelId });
      throw new ProviderError('bedrock', (err as Error).message);
    }
    if (!body) return;
    for await (const event of body) {
      const bytes = event.chunk?.bytes;
      if (!bytes) continue;
      const e = JSON.parse(new TextDecoder().decode(bytes));
      if (e.type === 'message_start') yield { inputTokens: e.message?.usage?.input_tokens };
      else if (e.type === 'content_block_delta' && e.delta?.text) yield { text: e.delta.text };
      else if (e.type === 'message_delta') yield { outputTokens: e.usage?.output_tokens, finishReason: e.delta?.stop_reason };
    }
  }
}
