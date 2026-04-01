import { AIProvider, NormalizedAIRequest, NormalizedAIResponse } from '@ai-governance/types';
import { ProviderError } from '@ai-governance/utils';
import { BedrockProvider } from '../providers/bedrock.provider';
import { OpenAIProvider } from '../providers/openai.provider';
import { ModelConfigRepository } from '../repositories/model-config.repository';

const MODEL_PROVIDER_MAP: Record<string, AIProvider> = {
  'anthropic.claude': 'bedrock',
  'amazon.titan': 'bedrock',
  'meta.llama': 'bedrock',
  'gpt-4': 'openai',
  'gpt-3.5': 'openai',
};

export class ProviderRouter {
  private bedrockProvider = new BedrockProvider();
  private openaiProvider = new OpenAIProvider();
  private modelConfigRepo = new ModelConfigRepository();

  resolveProvider(modelId: string): AIProvider {
    for (const [prefix, provider] of Object.entries(MODEL_PROVIDER_MAP)) {
      if (modelId.startsWith(prefix)) return provider;
    }
    return 'bedrock';
  }

  async route(request: NormalizedAIRequest): Promise<NormalizedAIResponse> {
    // Look up model config to get the stored API key
    const configs = await this.modelConfigRepo.getForTenant(request.tenantId);
    const modelConfig = configs.find((c) => c.modelId === request.modelId);
    const storedKey = (modelConfig as any)?.apiKeyStored;

    if (request.provider === 'openai') {
      return this.openaiProvider.complete(request, storedKey);
    }
    if (request.provider === 'bedrock') {
      return this.bedrockProvider.complete(request);
    }

    throw new ProviderError(request.provider, 'Provider not configured');
  }

  async getModelsForTenant(tenantId: string) {
    const configs = await this.modelConfigRepo.getForTenant(tenantId);
    return {
      models: configs
        .filter((c) => c.status === 'active')
        .map((c) => ({ id: c.modelId, provider: c.provider, name: c.name })),
    };
  }
}
