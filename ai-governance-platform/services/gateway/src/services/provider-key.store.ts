import {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
  GetSecretValueCommand,
  DeleteSecretCommand,
  ResourceExistsException,
} from '@aws-sdk/client-secrets-manager';
import { ModelConfig } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:provider-keys');

/** Minimal secret storage operations, so tests can swap in a fake. */
export interface SecretBackend {
  /** Create or overwrite a secret by name. Returns its ARN. */
  put(name: string, value: string, tags: Record<string, string>): Promise<string>;
  get(arn: string): Promise<string>;
  delete(arn: string): Promise<void>;
}

export class SecretsManagerBackend implements SecretBackend {
  private client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

  async put(name: string, value: string, tags: Record<string, string>): Promise<string> {
    try {
      const created = await this.client.send(new CreateSecretCommand({
        Name: name,
        SecretString: value,
        KmsKeyId: process.env.PROVIDER_KEYS_KMS_KEY_ID || undefined,
        Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
      }));
      return created.ARN!;
    } catch (err) {
      if (!(err instanceof ResourceExistsException)) throw err;
      const updated = await this.client.send(new PutSecretValueCommand({ SecretId: name, SecretString: value }));
      return updated.ARN!;
    }
  }

  async get(arn: string): Promise<string> {
    const result = await this.client.send(new GetSecretValueCommand({ SecretId: arn }));
    if (!result.SecretString) throw new Error('Secret has no value');
    return result.SecretString;
  }

  async delete(arn: string): Promise<void> {
    // Keep the default recovery window so an accidental delete can be undone.
    await this.client.send(new DeleteSecretCommand({ SecretId: arn }));
  }
}

/**
 * Stores customers' provider API keys (OpenAI, Anthropic, ...) in Secrets Manager.
 * Model configs only keep the secret ARN and a display hint; the raw key never touches DynamoDB.
 */
export class ProviderKeyStore {
  private cache = new Map<string, { value: string; until: number }>();

  constructor(
    private backend: SecretBackend = new SecretsManagerBackend(),
    private cacheTtlMs = 5 * 60_000,
    private prefix = process.env.PROVIDER_KEYS_SECRET_PREFIX || `aegis/${process.env.STAGE || 'dev'}/provider-keys`,
  ) {}

  secretName(tenantId: string, modelConfigId: string): string {
    return `${this.prefix}/${tenantId}/${modelConfigId}`;
  }

  /** Save (or replace) the key for a model config. Returns the secret ARN to store on the config. */
  async save(tenantId: string, modelConfigId: string, apiKey: string): Promise<string> {
    const arn = await this.backend.put(this.secretName(tenantId, modelConfigId), apiKey, { tenantId, modelConfigId });
    this.cache.set(arn, { value: apiKey, until: Date.now() + this.cacheTtlMs });
    return arn;
  }

  /** The provider key for a model config, or undefined if none is configured. */
  async resolve(config: Pick<ModelConfig, 'apiKeySecretArn'> | undefined): Promise<string | undefined> {
    const arn = config?.apiKeySecretArn;
    if (!arn) return undefined;
    const cached = this.cache.get(arn);
    if (cached && cached.until > Date.now()) return cached.value;
    const value = await this.backend.get(arn);
    this.cache.set(arn, { value, until: Date.now() + this.cacheTtlMs });
    return value;
  }

  async remove(config: Pick<ModelConfig, 'apiKeySecretArn'> | null | undefined): Promise<void> {
    const arn = config?.apiKeySecretArn;
    if (!arn) return;
    this.cache.delete(arn);
    try {
      await this.backend.delete(arn);
    } catch (err) {
      logger.warn('Failed to delete provider key secret', { error: (err as Error).message });
    }
  }
}

export function apiKeyHint(apiKey: string): string {
  return `...${apiKey.slice(-4)}`;
}
