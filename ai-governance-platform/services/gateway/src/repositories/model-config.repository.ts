import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, QueryCommand, PutCommand,
  UpdateCommand, DeleteCommand, GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { ModelConfig } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { randomUUID } from 'crypto';

const logger = createLogger('gateway:model-config-repo');

export class ModelConfigRepository {
  private client: DynamoDBDocumentClient;
  private table = process.env.MODELS_TABLE || 'ai-gov-models-dev';

  constructor() {
    const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
    this.client = DynamoDBDocumentClient.from(dynamo);
  }

  async getForTenant(tenantId: string): Promise<ModelConfig[]> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: 'tenantId = :tid',
          ExpressionAttributeValues: { ':tid': tenantId },
        })
      );
      return (result.Items || []) as ModelConfig[];
    } catch (err) {
      logger.error('Failed to fetch model configs', { tenantId, error: err });
      return [];
    }
  }

  async getById(tenantId: string, modelConfigId: string): Promise<ModelConfig | null> {
    try {
      const result = await this.client.send(
        new GetCommand({
          TableName: this.table,
          Key: { tenantId, modelConfigId },
        })
      );
      return (result.Item as ModelConfig) ?? null;
    } catch (err) {
      logger.error('Failed to get model config', { modelConfigId, error: err });
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
    await this.client.send(new PutCommand({ TableName: this.table, Item: config }));
    logger.info('Model config created', { modelConfigId: config.modelConfigId, tenantId: config.tenantId });
    return config;
  }

  async update(tenantId: string, modelConfigId: string, data: Partial<ModelConfig>): Promise<ModelConfig> {
    const updated = { ...data, tenantId, modelConfigId, updatedAt: new Date().toISOString() };
    await this.client.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { tenantId, modelConfigId },
        UpdateExpression: 'SET #name = :name, #status = :status, isDefault = :isDefault, ' +
          'maxTokensPerRequest = :maxTokens, inputCostPer1kTokens = :inputCost, ' +
          'outputCostPer1kTokens = :outputCost, allowedForRoles = :roles, ' +
          'allowedForApps = :apps, requiresApproval = :approval, tags = :tags, ' +
          'updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#name': 'name', '#status': 'status' },
        ExpressionAttributeValues: {
          ':name': data.name,
          ':status': data.status,
          ':isDefault': data.isDefault,
          ':maxTokens': data.maxTokensPerRequest,
          ':inputCost': data.inputCostPer1kTokens,
          ':outputCost': data.outputCostPer1kTokens,
          ':roles': data.allowedForRoles,
          ':apps': data.allowedForApps,
          ':approval': data.requiresApproval,
          ':tags': data.tags,
          ':updatedAt': updated.updatedAt,
        },
      })
    );
    return updated as ModelConfig;
  }

  async updateTestResult(tenantId: string, modelConfigId: string, success: boolean): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { tenantId, modelConfigId },
        UpdateExpression: 'SET lastTestedAt = :t, lastTestStatus = :s',
        ExpressionAttributeValues: {
          ':t': new Date().toISOString(),
          ':s': success ? 'pass' : 'fail',
        },
      })
    );
  }

  async delete(tenantId: string, modelConfigId: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({ TableName: this.table, Key: { tenantId, modelConfigId } })
    );
  }
}
