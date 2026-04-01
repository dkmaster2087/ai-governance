import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { Policy } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { randomUUID } from 'crypto';

const logger = createLogger('policy-engine:repository');

export class PolicyRepository {
  private client: DynamoDBDocumentClient;
  private tableName = process.env.POLICIES_TABLE || 'ai-governance-policies';

  constructor() {
    const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
    this.client = DynamoDBDocumentClient.from(dynamo);
  }

  async getPoliciesForTenant(tenantId: string): Promise<Policy[]> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'tenantId = :tid',
          ExpressionAttributeValues: { ':tid': tenantId },
        })
      );
      return (result.Items || []) as Policy[];
    } catch (err) {
      logger.error('Failed to fetch policies', { tenantId, error: err });
      return [];
    }
  }

  async createPolicy(data: Omit<Policy, 'policyId' | 'createdAt' | 'updatedAt'>): Promise<Policy> {
    const policy: Policy = {
      ...data,
      policyId: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.client.send(new PutCommand({ TableName: this.tableName, Item: policy }));
    return policy;
  }

  async updatePolicy(policyId: string, data: Partial<Policy>): Promise<Policy> {
    // Need tenantId for the composite key — it must be in data
    const tenantId = data.tenantId;
    if (!tenantId) throw new Error('tenantId required for updatePolicy');
    const updatedAt = new Date().toISOString();
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, policyId },
        UpdateExpression: 'SET #name = :name, description = :desc, enabled = :enabled, rules = :rules, updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: {
          ':name': data.name,
          ':desc': data.description,
          ':enabled': data.enabled,
          ':rules': data.rules ?? [],
          ':updatedAt': updatedAt,
        },
      })
    );
    return { ...data, policyId, updatedAt } as Policy;
  }

  async deletePolicy(policyId: string, tenantId: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({ TableName: this.tableName, Key: { tenantId, policyId } })
    );
  }
}
