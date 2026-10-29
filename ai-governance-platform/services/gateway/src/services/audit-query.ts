import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { AuditLog } from '@ai-governance/types';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

/**
 * Audit records for a tenant between two ISO timestamps, newest first, following DynamoDB pagination.
 * Stops at `maxItems` so one huge range can't exhaust memory; `truncated` says when that happened.
 */
export async function queryAuditLogs(
  tenantId: string,
  from: string,
  to: string,
  maxItems = 20_000
): Promise<{ logs: AuditLog[]; truncated: boolean }> {
  const table = process.env.AUDIT_LOGS_TABLE || 'ai-gov-audit-logs-dev';
  const logs: AuditLog[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(new QueryCommand({
      TableName: table,
      IndexName: 'tenantId-timestamp-index',
      KeyConditionExpression: 'tenantId = :tid AND #ts BETWEEN :from AND :to',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: { ':tid': tenantId, ':from': from, ':to': to },
      ScanIndexForward: false,
      ExclusiveStartKey: lastKey,
    }));
    logs.push(...((page.Items ?? []) as AuditLog[]));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey && logs.length < maxItems);
  return { logs: logs.slice(0, maxItems), truncated: !!lastKey || logs.length > maxItems };
}
