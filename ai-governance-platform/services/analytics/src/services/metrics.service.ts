import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('analytics:metrics');

export class MetricsService {
  private client: DynamoDBDocumentClient;
  private metricsTable = process.env.METRICS_TABLE || 'ai-governance-metrics';

  constructor() {
    const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
    this.client = DynamoDBDocumentClient.from(dynamo);
  }

  async getSummary(tenantId: string, period: string) {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.metricsTable,
          KeyConditionExpression: 'tenantId = :tid AND begins_with(period, :p)',
          ExpressionAttributeValues: { ':tid': tenantId, ':p': this.periodPrefix(period) },
          ScanIndexForward: false,
          Limit: 30,
        })
      );
      return { tenantId, period, data: result.Items || [] };
    } catch (err) {
      logger.error('Failed to fetch metrics summary', { tenantId, error: err });
      return { tenantId, period, data: [] };
    }
  }

  async getCostBreakdown(tenantId: string, from?: string, to?: string) {
    return { tenantId, from, to, breakdown: [] };
  }

  async getModelDistribution(tenantId: string) {
    return { tenantId, distribution: [] };
  }

  async getViolations(tenantId: string) {
    return { tenantId, violations: [] };
  }

  private periodPrefix(period: string): string {
    const now = new Date();
    if (period === '24h') return now.toISOString().slice(0, 10);
    if (period === '7d') return now.toISOString().slice(0, 7);
    return now.toISOString().slice(0, 4);
  }
}
