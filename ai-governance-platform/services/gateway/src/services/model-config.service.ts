import { ModelConfig, ModelTestResult } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { ModelConfigRepository } from '../repositories/model-config.repository';
import { BedrockProvider } from '../providers/bedrock.provider';
import { OpenAIProvider } from '../providers/openai.provider';

const logger = createLogger('gateway:model-config-service');

export class ModelConfigService {
  private repo = new ModelConfigRepository();

  async getModelsForTenant(tenantId: string): Promise<ModelConfig[]> {
    const configs = await this.repo.getForTenant(tenantId);
    // Never return API key secrets — only hints
    return configs.map(this.sanitize);
  }

  async createModel(
    tenantId: string,
    data: Omit<ModelConfig, 'modelConfigId' | 'createdAt' | 'updatedAt' | 'tenantId'>,
    createdBy: string
  ): Promise<ModelConfig> {
    // If this is set as default, unset any existing default
    if (data.isDefault) {
      await this.clearDefaultForTenant(tenantId);
    }
    const config = await this.repo.create({ ...data, tenantId, createdBy });
    return this.sanitize(config);
  }

  async updateModel(
    tenantId: string,
    modelConfigId: string,
    data: Partial<ModelConfig>
  ): Promise<ModelConfig> {
    if (data.isDefault) {
      await this.clearDefaultForTenant(tenantId);
    }
    const updated = await this.repo.update(tenantId, modelConfigId, data);
    return this.sanitize(updated);
  }

  async deleteModel(tenantId: string, modelConfigId: string): Promise<void> {
    await this.repo.delete(tenantId, modelConfigId);
  }

  async testModel(tenantId: string, modelConfigId: string): Promise<ModelTestResult> {
    const config = await this.repo.getById(tenantId, modelConfigId);
    if (!config) {
      return { modelConfigId, success: false, latencyMs: 0, error: 'Model config not found', testedAt: new Date().toISOString() };
    }

    const start = Date.now();
    try {
      const testRequest = {
        requestId: `test_${Date.now()}`,
        tenantId,
        userId: 'system',
        appId: 'model-test',
        provider: config.provider as any,
        modelId: config.modelId,
        messages: [{ role: 'user' as const, content: 'Say "OK" in one word.' }],
        maxTokens: 10,
        metadata: {},
        timestamp: new Date().toISOString(),
      };

      if (config.provider === 'bedrock') {
        await new BedrockProvider().complete(testRequest);
      } else if (config.provider === 'openai' || config.provider === 'anthropic') {
        const storedKey = (config as any).apiKeyStored;
        await new OpenAIProvider().complete(testRequest, storedKey);
      }

      const latencyMs = Date.now() - start;
      await this.repo.updateTestResult(tenantId, modelConfigId, true);
      logger.info('Model test passed', { modelConfigId, latencyMs });
      return { modelConfigId, success: true, latencyMs, testedAt: new Date().toISOString() };
    } catch (err) {
      const latencyMs = Date.now() - start;
      await this.repo.updateTestResult(tenantId, modelConfigId, false);
      logger.warn('Model test failed', { modelConfigId, error: err });
      return {
        modelConfigId, success: false, latencyMs,
        error: (err as Error).message,
        testedAt: new Date().toISOString(),
      };
    }
  }

  private sanitize(config: ModelConfig): ModelConfig {
    // Strip secrets from response — clients only see the hint
    const { apiKeySecretArn, apiKeyStored, ...safe } = config as any;
    return safe as ModelConfig;
  }

  private async clearDefaultForTenant(tenantId: string): Promise<void> {
    const existing = await this.repo.getForTenant(tenantId);
    const currentDefault = existing.find((m) => m.isDefault);
    if (currentDefault) {
      await this.repo.update(tenantId, currentDefault.modelConfigId, { ...currentDefault, isDefault: false });
    }
  }
}
