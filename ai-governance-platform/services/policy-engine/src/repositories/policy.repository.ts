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

  /** Find a policy linked to a specific compliance framework */
  async findByFramework(tenantId: string, framework: string): Promise<Policy | null> {
    const policies = await this.getPoliciesForTenant(tenantId);
    return policies.find((p) => p.sourceFramework === framework) ?? null;
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
    const tenantId = data.tenantId;
    if (!tenantId) throw new Error('tenantId required for updatePolicy');
    const updatedAt = new Date().toISOString();

    // Build dynamic update expression to preserve sourceFramework and other fields
    const updates: string[] = ['#name = :name', '#desc = :desc', '#enabled = :enabled', '#rules = :rules', '#updatedAt = :updatedAt'];
    const names: Record<string, string> = { '#name': 'name', '#desc': 'description', '#enabled': 'enabled', '#rules': 'rules', '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = {
      ':name': data.name,
      ':desc': data.description,
      ':enabled': data.enabled,
      ':rules': data.rules ?? [],
      ':updatedAt': updatedAt,
    };

    if (data.sourceFramework !== undefined) {
      updates.push('#sf = :sf');
      names['#sf'] = 'sourceFramework';
      values[':sf'] = data.sourceFramework;
    }

    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, policyId },
        UpdateExpression: `SET ${updates.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );
    return { ...data, policyId, updatedAt } as Policy;
  }

  /** Enable or disable a policy without changing anything else */
  async setEnabled(policyId: string, tenantId: string, enabled: boolean): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, policyId },
        UpdateExpression: 'SET enabled = :e, updatedAt = :u',
        ExpressionAttributeValues: { ':e': enabled, ':u': new Date().toISOString() },
      })
    );
  }

  async deletePolicy(policyId: string, tenantId: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({ TableName: this.tableName, Key: { tenantId, policyId } })
    );
  }
}
