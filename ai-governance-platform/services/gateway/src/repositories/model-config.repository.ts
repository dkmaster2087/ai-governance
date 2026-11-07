import { allPages, collection } from '@ai-governance/storage';
import { ModelConfig } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { randomUUID } from 'crypto';

const logger = createLogger('gateway:model-config-repo');

/** Fields a model config update may change. */
const EDITABLE = ['name', 'status', 'isDefault', 'maxTokensPerRequest', 'inputCostPer1kTokens', 'outputCostPer1kTokens', 'allowedKeyIds', 'tags', 'region', 'modelId', 'provider', 'endpoint', 'apiKeyHint', 'apiKeySecretArn'] as const;

const notFound = () => Object.assign(new Error('Model config not found'), { statusCode: 404, code: 'NOT_FOUND' });

export class ModelConfigRepository {
  private models = () => collection<ModelConfig & Record<string, unknown>>('models');

  async getForTenant(tenantId: string): Promise<ModelConfig[]> {
    try {
      return await allPages((after) => this.models().query({ partition: tenantId, after }));
    } catch (err) {
      logger.error('Failed to fetch model configs', { tenantId, error: (err as Error).message });
      return [];
    }
  }

  /** The company's configuration for a model, for the request path. Errors are thrown, not hidden. */
  async findByModelId(tenantId: string, modelId: string): Promise<ModelConfig | null> {
    const all = await allPages((after) => this.models().query({ partition: tenantId, after }));
    return all.find((c) => c.modelId === modelId) ?? null;
  }

  async getById(tenantId: string, modelConfigId: string): Promise<ModelConfig | null> {
    try {
      return await this.models().get({ tenantId, modelConfigId });
    } catch (err) {
      logger.error('Failed to get model config', { modelConfigId, error: (err as Error).message });
      return null;
    }
  }

  async create(data: Omit<ModelConfig, 'modelConfigId' | 'createdAt' | 'updatedAt'>): Promise<ModelConfig> {
    const config: ModelConfig = {
      ...data,
      modelConfigId: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.models().put(config as ModelConfig & Record<string, unknown>);
    logger.info('Model config created', { modelConfigId: config.modelConfigId, tenantId: config.tenantId });
    return config;
  }

  /** Change the given fields (undefined ones are left alone) and return the config as it now is. */
  async update(tenantId: string, modelConfigId: string, data: Partial<ModelConfig>): Promise<ModelConfig> {
    const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const f of EDITABLE) {
      const v = (data as Record<string, unknown>)[f];
      if (v !== undefined) set[f] = v;
    }
    const updated = await this.models().update({ tenantId, modelConfigId }, { set, ifExists: true });
    if (!updated) throw notFound();
    return updated;
  }

  /**
   * Point a model config at its Secrets Manager secret and delete any plaintext key left by
   * older versions (the `apiKeyStored` attribute).
   */
  async setApiKeySecret(tenantId: string, modelConfigId: string, secretArn: string, hint?: string): Promise<void> {
    const updated = await this.models().update({ tenantId, modelConfigId }, {
      set: { apiKeySecretArn: secretArn, updatedAt: new Date().toISOString(), ...(hint ? { apiKeyHint: hint } : {}) },
      remove: ['apiKeyStored'],
      ifExists: true,
    });
    if (!updated) throw notFound();
  }

  async updateTestResult(tenantId: string, modelConfigId: string, success: boolean): Promise<void> {
    await this.models().update({ tenantId, modelConfigId }, {
      set: { lastTestedAt: new Date().toISOString(), lastTestStatus: success ? 'pass' : 'fail' },
      ifExists: true,
    });
  }

  async delete(tenantId: string, modelConfigId: string): Promise<void> {
    await this.models().delete({ tenantId, modelConfigId });
  }
}
