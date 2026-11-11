import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand, Message, SystemContentBlock } from '@aws-sdk/client-bedrock-runtime';
import { NormalizedAIRequest, NormalizedAIResponse } from '@ai-governance/types';
import { ProviderError, createLogger } from '@ai-governance/utils';
import type { StreamDelta } from './openai.provider';

const logger = createLogger('gateway:bedrock');

/**
 * Amazon Bedrock through its Converse API, which speaks one format for every model Bedrock hosts: Claude, Amazon
 * Nova, Llama, Mistral and the rest. Model IDs can be base models (`amazon.nova-micro-v1:0`) or inference
 * profiles (`us.amazon.nova-micro-v1:0`), whichever the account has access to.
 */
export function toConverse(request: NormalizedAIRequest): { system: SystemContentBlock[]; messages: Message[] } {
  const system: SystemContentBlock[] = [];
  if (request.systemPrompt) system.push({ text: request.systemPrompt });
  const messages: Message[] = [];
  for (const m of request.messages) {
    if (m.role === 'system') { if (m.content) system.push({ text: m.content }); continue; }
    if (!m.content) continue;
    // Converse wants turns to alternate; consecutive messages from the same side become one turn.
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content!.push({ text: m.content });
    else messages.push({ role: m.role, content: [{ text: m.content }] });
  }
  return { system, messages };
}

/** Bedrock's stop reasons in the OpenAI words apps expect (stop, length, content_filter, tool_calls). */
export function finishReason(stop: string | undefined): string {
  switch (stop) {
    case undefined: case 'end_turn': case 'stop_sequence': return 'stop';
    case 'max_tokens': case 'model_context_window_exceeded': return 'length';
    case 'guardrail_intervened': case 'content_filtered': return 'content_filter';
    case 'tool_use': return 'tool_calls';
    default: return stop;
  }
}

const inference = (request: NormalizedAIRequest) => ({
  maxTokens: request.maxTokens || 1024,
  ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
});

export class BedrockProvider {
  private client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

  async complete(request: NormalizedAIRequest): Promise<NormalizedAIResponse> {
    const start = Date.now();
    const { system, messages } = toConverse(request);
    try {
      const res = await this.client.send(new ConverseCommand({
        modelId: request.modelId,
        messages,
        ...(system.length ? { system } : {}),
        inferenceConfig: inference(request),
      }));
      const content = (res.output?.message?.content ?? []).map((b) => b.text ?? '').join('');
      return {
        requestId: request.requestId,
        provider: 'bedrock',
        modelId: request.modelId,
        content,
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
        latencyMs: Date.now() - start,
        finishReason: finishReason(res.stopReason),
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      logger.error('Bedrock invocation failed', { error: err, modelId: request.modelId });
      throw new ProviderError('bedrock', (err as Error).message);
    }
  }

  /** Stream an answer from any Bedrock model. */
  async *stream(request: NormalizedAIRequest, signal?: AbortSignal): AsyncGenerator<StreamDelta> {
    const { system, messages } = toConverse(request);
    let stream;
    try {
      const res = await this.client.send(new ConverseStreamCommand({
        modelId: request.modelId,
        messages,
        ...(system.length ? { system } : {}),
        inferenceConfig: inference(request),
      }), { abortSignal: signal });
      stream = res.stream;
    } catch (err) {
      logger.error('Bedrock stream failed', { error: err, modelId: request.modelId });
      throw new ProviderError('bedrock', (err as Error).message);
    }
    if (!stream) return;
    for await (const event of stream) {
      if (event.contentBlockDelta?.delta?.text) yield { text: event.contentBlockDelta.delta.text };
      else if (event.messageStop) yield { finishReason: finishReason(event.messageStop.stopReason) };
      else if (event.metadata?.usage) yield { inputTokens: event.metadata.usage.inputTokens, outputTokens: event.metadata.usage.outputTokens };
      else {
        const failure = event.internalServerException ?? event.modelStreamErrorException ?? event.throttlingException ?? event.validationException ?? event.serviceUnavailableException;
        if (failure) throw new ProviderError('bedrock', failure.message ?? 'the stream failed');
      }
    }
  }
}
