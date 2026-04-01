import { AIProvider, NormalizedAIRequest, NormalizedAIResponse } from '@ai-governance/types';
import { ProviderError } from '@ai-governance/utils';
import { BedrockProvider } from '../providers/bedrock.provider';
import { OpenAIProvider } from '../providers/openai.provider';

const MODEL_PROVIDER_MAP: Record<string, AIProvider> = {
  'anthropic.claude': 'bedrock',
  'amazon.titan': 'bedrock',
  'meta.llama': 'bedrock',
  'gpt-4': 'openai',
  'gpt-3.5': 'openai',
};

export class ProviderRouter {
  private providers = {
    bedrock: new BedrockProvider(),
    openai: new OpenAIProvider(),
  };

  resolveProvider(modelId: string): AIProvider {
    for (const [prefix, provider] of Object.entries(MODEL_PROVIDER_MAP)) {
      if (modelId.startsWith(prefix)) return provider;
    }
    return 'bedrock'; // default
  }

  async route(request: NormalizedAIRequest): Promise<NormalizedAIResponse> {
    const provider = this.providers[request.provider as keyof typeof this.providers];
    if (!provider) {
      throw new ProviderError(request.provider, 'Provider not configured');
    }
    return provider.complete(request);
  }

  async getModelsForTenant(_tenantId: string) {
    return {
      models: [
        { id: 'anthropic.claude-3-sonnet-20240229-v1:0', provider: 'bedrock', name: 'Claude 3 Sonnet' },
        { id: 'anthropic.claude-3-haiku-20240307-v1:0', provider: 'bedrock', name: 'Claude 3 Haiku' },
        { id: 'amazon.titan-text-express-v1', provider: 'bedrock', name: 'Titan Text Express' },
        { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o' },
      ],
    };
  }
}
