import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { NormalizedAIRequest, NormalizedAIResponse } from '@ai-governance/types';
import { ProviderError, createLogger } from '@ai-governance/utils';

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
}
