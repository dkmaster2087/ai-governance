import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, PutCommand, QueryCommand,
  GetCommand, UpdateCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { createLogger } from '@ai-governance/utils';
import { randomBytes, createHash } from 'crypto';

const logger = createLogger('gateway:api-keys');

export interface ApiKey {
  tenantId: string;
  keyId: string;
  keyHash: string;        // SHA-256 hash of the full key (we never store the raw key)
  keyPrefix: string;      // First 8 chars for display (e.g., "aegis_dk...")
  name: string;           // Human-readable label
  scopes: string[];       // e.g., ['chat', 'models', 'audit']
  status: 'active' | 'revoked' | 'expired';
  rateLimit: number;      // Requests per minute for this key
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  createdBy: string;
}

/** Generate a secure API key: aegis_<tenantShort>_<random32hex> */
export function generateApiKey(tenantId: string): { raw: string; hash: string; prefix: string; keyId: string } {
  const tenantShort = tenantId.replace('tenant_', '').slice(0, 6);
  const random = randomBytes(24).toString('hex');
  const raw = `aegis_${tenantShort}_${random}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 16) + '...';
  const keyId = `key_${randomBytes(8).toString('hex')}`;
  return { raw, hash, prefix, keyId };
}

/** Hash a raw API key for lookup */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export class ApiKeyRepository {
  private client: DynamoDBDocumentClient;
  private table: string;

  constructor() {
    const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
    this.client = DynamoDBDocumentClient.from(dynamo);
    this.table = process.env.API_KEYS_TABLE || 'ai-gov-api-keys-dev';
  }

  /** Create a new API key record */
  async create(key: ApiKey): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.table, Item: key }));
    logger.info('API key created', { tenantId: key.tenantId, keyId: key.keyId, name: key.name });
  }

  /** Get all keys for a tenant */
  async getForTenant(tenantId: string): Promise<ApiKey[]> {
    try {
      const result = await this.client.send(new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'tenantId = :tid',
        ExpressionAttributeValues: { ':tid': tenantId },
      }));
      return (result.Items || []) as ApiKey[];
    } catch (err) {
      logger.warn('API keys table not available', { tenantId });
      return [];
    }
  }

  /** Find a key by its hash (for auth validation) */
  async findByHash(keyHash: string): Promise<ApiKey | null> {
    try {
      // Scan with filter — in production, use a GSI on keyHash
      const result = await this.client.send(new QueryCommand({
        TableName: this.table,
        IndexName: 'keyHash-index',
        KeyConditionExpression: 'keyHash = :kh',
        ExpressionAttributeValues: { ':kh': keyHash },
      }));
      const item = result.Items?.[0] as ApiKey | undefined;
      return item || null;
    } catch {
      // Fallback: scan (for local dev without GSI)
      return this.findByHashScan(keyHash);
    }
  }

  private async findByHashScan(keyHash: string): Promise<ApiKey | null> {
    try {
      const { ScanCommand: SC } = await import('@aws-sdk/lib-dynamodb');
      const result = await this.client.send(new SC({
        TableName: this.table,
        FilterExpression: 'keyHash = :kh',
        ExpressionAttributeValues: { ':kh': keyHash },
      }));
      return (result.Items?.[0] as ApiKey) || null;
    } catch {
      return null;
    }
  }

  /** Revoke a key */
  async revoke(tenantId: string, keyId: string): Promise<void> {
    await this.client.send(new UpdateCommand({
      TableName: this.table,
      Key: { tenantId, keyId },
      UpdateExpression: 'SET #status = :s',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':s': 'revoked' },
    }));
    logger.info('API key revoked', { tenantId, keyId });
  }

  /** Update last used timestamp */
  async touchLastUsed(tenantId: string, keyId: string): Promise<void> {
    try {
      await this.client.send(new UpdateCommand({
        TableName: this.table,
        Key: { tenantId, keyId },
        UpdateExpression: 'SET lastUsedAt = :ts',
        ExpressionAttributeValues: { ':ts': new Date().toISOString() },
      }));
    } catch { /* non-critical */ }
  }

  /** Delete a key permanently */
  async delete(tenantId: string, keyId: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.table,
      Key: { tenantId, keyId },
    }));
    logger.info('API key deleted', { tenantId, keyId });
  }
}
