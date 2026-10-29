import { AIProvider, NormalizedAIRequest, NormalizedAIResponse } from '@ai-governance/types';
import { ProviderError } from '@ai-governance/utils';
import { BedrockProvider } from '../providers/bedrock.provider';
import { OpenAIProvider } from '../providers/openai.provider';
import { ModelConfigRepository } from '../repositories/model-config.repository';
import { ModelConfigService } from './model-config.service';

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
  private modelConfigService = new ModelConfigService(this.modelConfigRepo);

  resolveProvider(modelId: string): AIProvider {
    for (const [prefix, provider] of Object.entries(MODEL_PROVIDER_MAP)) {
      if (modelId.startsWith(prefix)) return provider;
    }
    return 'bedrock';
  }

  async route(request: NormalizedAIRequest): Promise<NormalizedAIResponse> {
    // Look up model config to get the tenant's provider key (held in Secrets Manager)
    const configs = await this.modelConfigRepo.getForTenant(request.tenantId);
    const modelConfig = configs.find((c) => c.modelId === request.modelId);
    const storedKey = await this.modelConfigService.resolveProviderKey(modelConfig);
    // The admin's configuration wins; the name-based guess is only for models nobody configured.
    const provider = (modelConfig?.provider as AIProvider | undefined) ?? request.provider;

    if (provider === 'openai') {
      return this.openaiProvider.complete({ ...request, provider }, storedKey);
    }
    if (provider === 'bedrock') {
      return this.bedrockProvider.complete({ ...request, provider });
    }

    throw new ProviderError(provider, 'Provider not configured');
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
