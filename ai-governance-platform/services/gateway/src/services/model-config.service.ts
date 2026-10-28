import { ModelConfig, ModelTestResult } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { ModelConfigRepository } from '../repositories/model-config.repository';
import { BedrockProvider } from '../providers/bedrock.provider';
import { OpenAIProvider } from '../providers/openai.provider';
import { ProviderKeyStore, apiKeyHint } from './provider-key.store';

const logger = createLogger('gateway:model-config-service');

export class ModelConfigService {
  constructor(
    private repo = new ModelConfigRepository(),
    private keys = new ProviderKeyStore(),
  ) {}

  async getModelsForTenant(tenantId: string): Promise<ModelConfig[]> {
    const configs = await this.repo.getForTenant(tenantId);
    // Never return API key secrets — only hints
    return configs.map(this.sanitize);
  }

  async createModel(
    tenantId: string,
    data: Omit<ModelConfig, 'modelConfigId' | 'createdAt' | 'updatedAt' | 'tenantId'>,
    createdBy: string,
    apiKey?: string
  ): Promise<ModelConfig> {
    // If this is set as default, unset any existing default
    if (data.isDefault) {
      await this.clearDefaultForTenant(tenantId);
    }
    const { apiKeySecretArn: _ignored, ...safeData } = data as typeof data & { apiKeySecretArn?: string };
    const config = await this.repo.create({ ...safeData, tenantId, createdBy });
    if (apiKey) {
      const arn = await this.keys.save(tenantId, config.modelConfigId, apiKey);
      const hint = apiKeyHint(apiKey);
      await this.repo.setApiKeySecret(tenantId, config.modelConfigId, arn, hint);
      return this.sanitize({ ...config, apiKeySecretArn: arn, apiKeyHint: hint });
    }
    return this.sanitize(config);
  }

  async updateModel(
    tenantId: string,
    modelConfigId: string,
    data: Partial<ModelConfig>,
    apiKey?: string
  ): Promise<ModelConfig> {
    if (data.isDefault) {
      await this.clearDefaultForTenant(tenantId);
    }
    // Secret references are only ever set by this service, never from client input.
    const { apiKeySecretArn: _ignored, ...safeData } = data;
    const updated = await this.repo.update(tenantId, modelConfigId, safeData);
    if (apiKey) {
      const arn = await this.keys.save(tenantId, modelConfigId, apiKey);
      await this.repo.setApiKeySecret(tenantId, modelConfigId, arn, apiKeyHint(apiKey));
      return this.sanitize({ ...updated, apiKeyHint: apiKeyHint(apiKey) });
    }
    return this.sanitize(updated);
  }

  async deleteModel(tenantId: string, modelConfigId: string): Promise<void> {
    const existing = await this.repo.getById(tenantId, modelConfigId);
    await this.repo.delete(tenantId, modelConfigId);
    await this.keys.remove(existing);
  }

  /**
   * The provider API key for a model config. Plaintext keys left by older versions are moved
   * into Secrets Manager the first time they're used.
   */
  async resolveProviderKey(config: ModelConfig | undefined): Promise<string | undefined> {
    if (!config) return undefined;
    const legacyKey = (config as ModelConfig & { apiKeyStored?: string }).apiKeyStored;
    if (legacyKey && !config.apiKeySecretArn) {
      try {
        const arn = await this.keys.save(config.tenantId, config.modelConfigId, legacyKey);
        await this.repo.setApiKeySecret(config.tenantId, config.modelConfigId, arn);
        logger.info('Moved legacy provider key into Secrets Manager', { modelConfigId: config.modelConfigId });
      } catch (err) {
        logger.error('Failed to move legacy provider key into Secrets Manager', { modelConfigId: config.modelConfigId, error: (err as Error).message });
      }
      return legacyKey;
    }
    return this.keys.resolve(config);
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
        const storedKey = await this.resolveProviderKey(config);
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
