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
    const updatedAt = new Date().toISOString();

    // Build dynamic update expression — only include fields that are defined
    const fieldMap: Record<string, { expr: string; alias: string; value: unknown }> = {
      name:                 { expr: '#name',              alias: '#name',   value: data.name },
      status:               { expr: '#status',            alias: '#status', value: data.status },
      isDefault:            { expr: 'isDefault',          alias: '',        value: data.isDefault },
      maxTokensPerRequest:  { expr: 'maxTokensPerRequest',alias: '',        value: data.maxTokensPerRequest },
      maxContextTokens:     { expr: 'maxContextTokens',   alias: '',        value: data.maxContextTokens },
      inputCostPer1kTokens: { expr: 'inputCostPer1kTokens',alias: '',      value: data.inputCostPer1kTokens },
      outputCostPer1kTokens:{ expr: 'outputCostPer1kTokens',alias: '',     value: data.outputCostPer1kTokens },
      allowedForRoles:      { expr: 'allowedForRoles',    alias: '',        value: data.allowedForRoles },
      allowedForApps:       { expr: 'allowedForApps',     alias: '',        value: data.allowedForApps },
      requiresApproval:     { expr: 'requiresApproval',   alias: '',        value: data.requiresApproval },
      tags:                 { expr: '#tags',               alias: '#tags',  value: data.tags },
      region:               { expr: '#region',             alias: '#region',value: data.region },
      modelId:              { expr: '#modelId',           alias: '#modelId', value: (data as any).modelId },
      provider:             { expr: '#provider',          alias: '#provider', value: (data as any).provider },
      endpoint:             { expr: 'endpoint',           alias: '',        value: data.endpoint },
      apiKeyHint:           { expr: 'apiKeyHint',         alias: '',        value: (data as any).apiKeyHint },
      apiKeyStored:         { expr: 'apiKeyStored',       alias: '',        value: (data as any).apiKeyStored },
    };

    const updates: string[] = ['updatedAt = :updatedAt'];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ':updatedAt': updatedAt };

    for (const [key, field] of Object.entries(fieldMap)) {
      if (field.value !== undefined) {
        const valKey = `:${key}`;
        updates.push(`${field.expr} = ${valKey}`);
        values[valKey] = field.value;
        if (field.alias) names[field.alias] = key;
      }
    }

    await this.client.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { tenantId, modelConfigId },
        UpdateExpression: `SET ${updates.join(', ')}`,
        ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
        ExpressionAttributeValues: values,
      })
    );
    return { ...data, tenantId, modelConfigId, updatedAt } as ModelConfig;
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
