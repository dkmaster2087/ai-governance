import { NormalizedAIRequest, NormalizedAIResponse, ChatMessage, PolicyEvaluationResult } from '@ai-governance/types';
import { generateRequestId, createLogger, GovernanceUnavailableError } from '@ai-governance/utils';
import { PolicyEngineClient } from '../clients/policy-engine.client';
import { DataProtectionClient } from '../clients/data-protection.client';
import { ProviderRouter } from './provider.router';
import { AuditService } from './audit.service';
import { ResponseScanner } from './response-scanner';
import { tenantSettings } from './tenant-settings.service';

const logger = createLogger('gateway');

interface ProcessRequestInput {
  tenantId: string;
  userId: string;
  appId: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export class GatewayService {
  private policyClient = new PolicyEngineClient();
  private dataProtectionClient = new DataProtectionClient();
  private providerRouter = new ProviderRouter();
  private auditService = new AuditService();
  private responseScanner = new ResponseScanner();
  private tenantSettings = tenantSettings();

  async processRequest(input: ProcessRequestInput): Promise<NormalizedAIResponse> {
    const requestId = generateRequestId();
    const timestamp = new Date().toISOString();

    logger.info('Processing AI request', { requestId, tenantId: input.tenantId, model: input.model });

    // 1. Build normalized request
    const normalizedRequest: NormalizedAIRequest = {
      requestId,
      tenantId: input.tenantId,
      userId: input.userId,
      appId: input.appId,
      provider: this.providerRouter.resolveProvider(input.model),
      modelId: input.model,
      messages: input.messages,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      metadata: {},
      timestamp,
    };

    const failMode = await this.tenantSettings.getFailMode(input.tenantId);
    /** Governance steps skipped because a dependency was down and the tenant fails open. */
    const degraded: string[] = [];
    const whenUnavailable = <T>(err: unknown, step: string, fallback: T): T => {
      if (err instanceof GovernanceUnavailableError && failMode === 'open') {
        logger.warn('Governance step skipped (tenant fails open)', { requestId, tenantId: input.tenantId, step });
        degraded.push(step);
        return fallback;
      }
      throw err;
    };

    // 2. Policy evaluation runs on the original prompt, so rules that look for PII or
    //    sensitive data see the real content rather than masked placeholders.
    let policyResult: PolicyEvaluationResult;
    try {
      policyResult = await this.policyClient.evaluate(normalizedRequest);
    } catch (err) {
      policyResult = whenUnavailable(err, 'policy_evaluation', {
        allowed: true, action: 'allow', triggeredRules: [], riskScore: 0,
        reason: 'Policy engine unavailable (tenant fails open)',
      } as PolicyEvaluationResult);
    }
    if (!policyResult.allowed) {
      await this.auditService.log(normalizedRequest, null, policyResult, 0);
      throw Object.assign(new Error(policyResult.reason || 'Request blocked by policy'), {
        code: 'POLICY_VIOLATION',
        statusCode: 403,
      });
    }

    // 3. Mask PII before the prompt leaves for the AI provider
    let protectedRequest: NormalizedAIRequest;
    try {
      protectedRequest = await this.dataProtectionClient.protectRequest(normalizedRequest);
    } catch (err) {
      protectedRequest = whenUnavailable(err, 'pii_masking', normalizedRequest);
    }

    // 4. Route to AI provider
    const startTime = Date.now();
    const response = await this.providerRouter.route(protectedRequest);
    const latencyMs = Date.now() - startTime;

    // 5. Scan response for PII leakage (in-process)
    const scannedResponse = this.responseScanner.scanResponse(response, true);

    // 6. Deeper response filtering via the data protection service. If it's down, the in-process
    //    scan above has already masked the response, so continue and record it.
    let filteredResponse: NormalizedAIResponse;
    try {
      filteredResponse = await this.dataProtectionClient.filterResponse(scannedResponse);
    } catch (err) {
      if (!(err instanceof GovernanceUnavailableError)) throw err;
      logger.warn('Response filtering unavailable, using in-process scan only', { requestId });
      degraded.push('response_filtering');
      filteredResponse = scannedResponse;
    }

    // 7. Audit log
    if (degraded.length > 0) {
      protectedRequest = { ...protectedRequest, metadata: { ...protectedRequest.metadata, governanceDegraded: degraded.join(',') } };
    }
    await this.auditService.log(protectedRequest, filteredResponse, policyResult, latencyMs);

    return filteredResponse;
  }

  async getAvailableModels(tenantId: string) {
    return this.providerRouter.getModelsForTenant(tenantId);
  }
}
