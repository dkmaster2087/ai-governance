import { NormalizedAIRequest, NormalizedAIResponse, PolicyEvaluationResult, AuditLog } from '@ai-governance/types';
import { hashContent, estimateCost, createLogger } from '@ai-governance/utils';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const logger = createLogger('gateway:audit');

export class AuditService {
  private s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    forcePathStyle: true,
  });
  private bucket = process.env.AUDIT_LOG_BUCKET || 'ai-governance-audit-logs';

  async log(
    request: NormalizedAIRequest,
    response: NormalizedAIResponse | null,
    policyResult: PolicyEvaluationResult,
    latencyMs: number
  ): Promise<void> {
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
        ? estimateCost(response.inputTokens, response.outputTokens, 0.003, 0.015)
        : 0,
      latencyMs,
      timestamp: new Date().toISOString(),
      metadata: request.metadata,
    };

    try {
      const key = `logs/${request.tenantId}/${new Date().toISOString().slice(0, 10)}/${log.logId}.json`;
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: JSON.stringify(log),
          ContentType: 'application/json',
          ServerSideEncryption: 'aws:kms',
        })
      );
    } catch (err) {
      // Audit failures should not break the request flow
      logger.error('Failed to write audit log', { error: err, requestId: request.requestId });
    }
  }
}
