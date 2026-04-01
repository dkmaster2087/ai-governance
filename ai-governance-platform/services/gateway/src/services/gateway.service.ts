import { NormalizedAIRequest, NormalizedAIResponse, ChatMessage } from '@ai-governance/types';
import { generateRequestId, createLogger } from '@ai-governance/utils';
import { PolicyEngineClient } from '../clients/policy-engine.client';
import { DataProtectionClient } from '../clients/data-protection.client';
import { ProviderRouter } from './provider.router';
import { AuditService } from './audit.service';

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

    // 2. PII masking on prompt
    const protectedRequest = await this.dataProtectionClient.protectRequest(normalizedRequest);

    // 3. Policy evaluation
    const policyResult = await this.policyClient.evaluate(protectedRequest);
    if (!policyResult.allowed) {
      await this.auditService.log(protectedRequest, null, policyResult, 0);
      throw Object.assign(new Error(policyResult.reason || 'Request blocked by policy'), {
        code: 'POLICY_VIOLATION',
        statusCode: 403,
      });
    }

    // 4. Route to AI provider
    const startTime = Date.now();
    const response = await this.providerRouter.route(protectedRequest);
    const latencyMs = Date.now() - startTime;

    // 5. Filter response for sensitive data
    const filteredResponse = await this.dataProtectionClient.filterResponse(response);

    // 6. Audit log
    await this.auditService.log(protectedRequest, filteredResponse, policyResult, latencyMs);

    return filteredResponse;
  }

  async getAvailableModels(tenantId: string) {
    return this.providerRouter.getModelsForTenant(tenantId);
  }
}
