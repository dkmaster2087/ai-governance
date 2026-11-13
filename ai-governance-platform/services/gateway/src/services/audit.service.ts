import { NormalizedAIRequest, NormalizedAIResponse, PolicyEvaluationResult, AuditLog } from '@ai-governance/types';
import { keySpend } from './key-spend';
import { alerting } from './alerting.service';
import { hashContent, estimateCost, createLogger } from '@ai-governance/utils';
import { collection } from '@ai-governance/storage';
import { archiveBatcher } from './archive-batcher';
import { ModelConfigRepository } from '../repositories/model-config.repository';
import { modelsForRequests } from '../repositories/model-cache';
import { redactSecrets } from './secret-detector';
import { expiryOf, retentionOf } from './retention';
import { OPS, opsMetrics } from './cloudwatch';

const logger = createLogger('gateway:audit');

function stopMetadata(base: Record<string, string>, result: PolicyEvaluationResult): Record<string, string> {
  const out: Record<string, string> = { ...base };
  if (result.reason) out.policyReason = redactSecrets(result.reason);
  if (result.evidence) {
    // A company rule's excerpt is cut from the original prompt, so a credential could sit inside it.
    // Evidence is kept for a year; never let one in.
    out.ruleType = result.evidence.ruleType;
    out.evidenceBefore = redactSecrets(result.evidence.before);
    out.evidenceHit = redactSecrets(result.evidence.hit);
    out.evidenceAfter = redactSecrets(result.evidence.after);
  }
  return out;
}

export class AuditService {
  private modelConfigRepo = new ModelConfigRepository();

  async log(
    request: NormalizedAIRequest,
    response: NormalizedAIResponse | null,
    policyResult: PolicyEvaluationResult,
    latencyMs: number,
    findings: { piiDetected?: boolean } = {}
  ): Promise<void> {
    // Look up model config for accurate pricing
    let inputCostPer1k = 0.003;
    let outputCostPer1k = 0.015;

    try {
      const configs = await modelsForRequests.get(request.tenantId, () => this.modelConfigRepo.getForTenant(request.tenantId));
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
      piiDetected: findings.piiDetected ?? false,
      piiTypes: [],
      inputTokens: response?.inputTokens || 0,
      outputTokens: response?.outputTokens || 0,
      estimatedCost: response
        ? estimateCost(response.inputTokens, response.outputTokens, inputCostPer1k, outputCostPer1k)
        : 0,
      latencyMs,
      timestamp: new Date().toISOString(),
      // For stopped requests, keep the readable reason and the (already masked) excerpt that triggered it.
      metadata: policyResult.allowed ? request.metadata : stopMetadata(request.metadata, policyResult),
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
    // The key's daily token and spend totals, if it has caps (off the request path).
    if (request.apiKeyId && response) {
      keySpend().record(log.tenantId, request.apiKeyId, log.inputTokens + log.outputTokens, log.estimatedCost).catch(() => {});
    }
    // Company alerts (stopped spikes, personal data in answers, spend), off the request path.
    alerting().signal(() => alerting().fromAuditRecord(log));
  }

  /**
   * Archive copy, written in batches (one gzipped JSON Lines file per company, day and batch; see ArchiveBatcher).
   * Resolves at once unless the archive has fallen behind.
   */
  private async writeToS3(log: AuditLog, _requestId: string): Promise<void> {
    await archiveBatcher().add(log);
  }

  /** The queryable record. */
  private async writeToDynamoDB(log: AuditLog): Promise<void> {
    if (log.eventType === 'request_blocked') opsMetrics.count(OPS.POLICY_VIOLATIONS);
    // Each record carries its own expiry, from the company's retention period (none while on legal hold).
    const ttl = expiryOf(log.timestamp, await retentionOf(log.tenantId));
    await collection('auditLogs').put({ ...log, dateKey: log.timestamp.slice(0, 10), ...(ttl ? { ttl } : {}) });
  }
}
