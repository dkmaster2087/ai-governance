import { NormalizedAIRequest, NormalizedAIResponse, PolicyEvaluationResult, AuditLog } from '@ai-governance/types';
import { hashContent, estimateCost, createLogger } from '@ai-governance/utils';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ModelConfigRepository } from '../repositories/model-config.repository';

const logger = createLogger('gateway:audit');

export class AuditService {
  private s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    forcePathStyle: true,
  });
  private bucket = process.env.AUDIT_LOG_BUCKET || 'ai-governance-audit-logs';
  private modelConfigRepo = new ModelConfigRepository();

  private ddbClient: DynamoDBDocumentClient;
  private auditTable = process.env.AUDIT_LOGS_TABLE || 'ai-gov-audit-logs-dev';

  constructor() {
    const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
    this.ddbClient = DynamoDBDocumentClient.from(dynamo);
  }

  async log(
    request: NormalizedAIRequest,
    response: NormalizedAIResponse | null,
    policyResult: PolicyEvaluationResult,
    latencyMs: number
  ): Promise<void> {
    // Look up model config for accurate pricing
    let inputCostPer1k = 0.003;
    let outputCostPer1k = 0.015;

    try {
      const configs = await this.modelConfigRepo.getForTenant(request.tenantId);
      const modelConfig = configs.find((c) => c.modelId === request.modelId);
      if (modelConfig) {
        inputCostPer1k = modelConfig.inputCostPer1kTokens;
        outputCostPer1k = modelConfig.outputCostPer1kTokens;
      }
    } catch (err) {
      logger.warn('Failed to look up model config for pricing, using defaults', {
        modelId: request.modelId,
        tenantId: request.tenantId,
        error: err,
      });
    }

    const log: AuditLog = {
      logId: `${request.requestId}-${Date.now()}`,
      requestId: request.requestId,
      tenantId: request.tenantId,
      userId: request.userId,
      appId: request.appId,
      eventType: policyResult.allowed ? 'request_allowed' : 'request_blocked',
      provider: request.provider,
      modelId: request.modelId,
      promptHash: hashContent(request.messages.map((m) => m.content).join('')),
      responseHash: response ? hashContent(response.content) : '',
      policyDecision: policyResult.action,
      triggeredRules: policyResult.triggeredRules,
      piiDetected: false,
      piiTypes: [],
      inputTokens: response?.inputTokens || 0,
      outputTokens: response?.outputTokens || 0,
      estimatedCost: response
        ? estimateCost(response.inputTokens, response.outputTokens, inputCostPer1k, outputCostPer1k)
        : 0,
      latencyMs,
      timestamp: new Date().toISOString(),
      metadata: request.metadata,
    };

    // Write to both S3 (archival) and DynamoDB (queryable by analytics)
    const s3Promise = this.writeToS3(log, request.requestId);
    const ddbPromise = this.writeToDynamoDB(log);

    try {
      await Promise.all([s3Promise, ddbPromise]);
    } catch (err) {
      // Audit failures should not break the request flow
      logger.error('Failed to write audit log', { error: err, requestId: request.requestId });
    }
  }

  private async writeToS3(log: AuditLog, requestId: string): Promise<void> {
    const key = `logs/${log.tenantId}/${new Date().toISOString().slice(0, 10)}/${log.logId}.json`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(log),
        ContentType: 'application/json',
        ServerSideEncryption: 'aws:kms',
      })
    );
  }

  private async writeToDynamoDB(log: AuditLog): Promise<void> {
    await this.ddbClient.send(
      new PutCommand({
        TableName: this.auditTable,
        Item: {
          ...log,
          // Add a date partition key for efficient querying
          dateKey: log.timestamp.slice(0, 10),
        },
      })
    );
  }
}
