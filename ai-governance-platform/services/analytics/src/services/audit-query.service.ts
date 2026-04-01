import { AthenaClient, StartQueryExecutionCommand, GetQueryResultsCommand, GetQueryExecutionCommand } from '@aws-sdk/client-athena';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('analytics:audit-query');

interface QueryLogsParams {
  tenantId: string;
  from?: string;
  to?: string;
  userId?: string;
  limit: number;
}

export class AuditQueryService {
  private athena = new AthenaClient({ region: process.env.AWS_REGION || 'us-east-1' });
  private database = process.env.ATHENA_DATABASE || 'ai_governance_logs';
  private outputBucket = process.env.ATHENA_OUTPUT_BUCKET || 's3://ai-governance-athena-results/';

  async queryLogs(params: QueryLogsParams) {
    const conditions = [`tenant_id = '${params.tenantId}'`];
    if (params.from) conditions.push(`timestamp >= '${params.from}'`);
    if (params.to) conditions.push(`timestamp <= '${params.to}'`);
    if (params.userId) conditions.push(`user_id = '${params.userId}'`);

    const sql = `
      SELECT * FROM audit_logs
      WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp DESC
      LIMIT ${params.limit}
    `;

    try {
      const execution = await this.athena.send(
        new StartQueryExecutionCommand({
          QueryString: sql,
          QueryExecutionContext: { Database: this.database },
          ResultConfiguration: { OutputLocation: this.outputBucket },
        })
      );

      const queryId = execution.QueryExecutionId!;
      await this.waitForQuery(queryId);

      const results = await this.athena.send(
        new GetQueryResultsCommand({ QueryExecutionId: queryId })
      );

      return { logs: results.ResultSet?.Rows || [], queryId };
    } catch (err) {
      logger.error('Athena query failed', { error: err, tenantId: params.tenantId });
      return { logs: [], error: 'Query failed' };
    }
  }

  private async waitForQuery(queryId: string, maxWaitMs = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const status = await this.athena.send(
        new GetQueryExecutionCommand({ QueryExecutionId: queryId })
      );
      const state = status.QueryExecution?.Status?.State;
      if (state === 'SUCCEEDED') return;
      if (state === 'FAILED' || state === 'CANCELLED') {
        throw new Error(`Athena query ${state}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('Athena query timed out');
  }
}
