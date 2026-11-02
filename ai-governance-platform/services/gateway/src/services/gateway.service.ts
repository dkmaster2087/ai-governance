import { NormalizedAIRequest, NormalizedAIResponse, ChatMessage, PolicyEvaluationResult } from '@ai-governance/types';
import { generateRequestId, createLogger, GovernanceUnavailableError } from '@ai-governance/utils';
import { PolicyEngineClient } from '../clients/policy-engine.client';
import { DataProtectionClient } from '../clients/data-protection.client';
import { ProviderRouter } from './provider.router';
import { AuditService } from './audit.service';
import { ResponseScanner } from './response-scanner';
import { StreamMasker } from './stream-masker';
import { tenantSettings } from './tenant-settings.service';
import { checkSecrets } from './secrets-check';

const logger = createLogger('gateway');

/** What a streamed answer yields to the route: text to send, then one final part. */
export type StreamPart = { text: string; done?: undefined } | { done: true; finishReason: string; inputTokens: number; outputTokens: number; text?: undefined };

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

  /**
   * Everything before the provider is called: policy evaluation on the original prompt, then personal-data
   * masking. Shared by normal and streamed requests, so a blocked request never starts a stream.
   */
  private async prepare(input: ProcessRequestInput) {
    const requestId = generateRequestId();
    const timestamp = new Date().toISOString();

    logger.info('Processing AI request', { requestId, tenantId: input.tenantId, model: input.model });

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

    // Policy evaluation runs on the original prompt, so rules that look for PII or
    // sensitive data see the real content rather than masked placeholders.
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
        requestId,
      });
    }

    // Check 2: credentials. Runs in-process, so it never depends on another service being up.
    const secrets = checkSecrets(input.messages, await this.tenantSettings.getSecretsAction(input.tenantId));
    if (secrets.outcome === 'blocked') {
      await this.auditService.log({ ...normalizedRequest, metadata: secrets.metadata }, null, secrets.result, 0);
      throw Object.assign(new Error(secrets.message), { code: 'SECRET_DETECTED', statusCode: 403, requestId });
    }
    const afterSecrets: NormalizedAIRequest = {
      ...normalizedRequest,
      ...(secrets.outcome === 'redacted' ? { messages: secrets.messages } : {}),
      metadata: { ...normalizedRequest.metadata, ...secrets.metadata },
    };

    // Check 3: mask personal data before the prompt leaves for the AI provider
    let protectedRequest: NormalizedAIRequest;
    try {
      const masked = await this.dataProtectionClient.protectRequest(afterSecrets);
      protectedRequest = { ...masked, metadata: { ...afterSecrets.metadata, ...masked.metadata } };
    } catch (err) {
      protectedRequest = whenUnavailable(err, 'pii_masking', afterSecrets);
    }
    return { requestId, normalizedRequest: afterSecrets, protectedRequest, policyResult, degraded };
  }

  /** Audit record for a completed (or abandoned) request. */
  private async record(prep: Awaited<ReturnType<GatewayService['prepare']>>, response: NormalizedAIResponse, latencyMs: number, extra: Record<string, string> = {}) {
    const { normalizedRequest, policyResult, degraded } = prep;
    let protectedRequest = prep.protectedRequest;
    const metadata = { ...protectedRequest.metadata, ...extra, ...(degraded.length > 0 ? { governanceDegraded: degraded.join(',') } : {}) };
    protectedRequest = { ...protectedRequest, metadata };
    // PII was masked if the data protection service changed any message (secrets were already removed before it ran).
    const piiDetected = protectedRequest.messages.some((m, i) => m.content !== normalizedRequest.messages[i]?.content);
    await this.auditService.log(protectedRequest, response, policyResult, latencyMs, { piiDetected });
  }

  async processRequest(input: ProcessRequestInput): Promise<NormalizedAIResponse> {
    const prep = await this.prepare(input);

    const startTime = Date.now();
    const response = await this.providerRouter.route(prep.protectedRequest);
    const latencyMs = Date.now() - startTime;

    // Scan the response for PII leakage (in-process)
    const scannedResponse = this.responseScanner.scanResponse(response, true);

    // Deeper response filtering via the data protection service. If it's down, the in-process
    // scan above has already masked the response, so continue and record it.
    let filteredResponse: NormalizedAIResponse;
    try {
      filteredResponse = await this.dataProtectionClient.filterResponse(scannedResponse);
    } catch (err) {
      if (!(err instanceof GovernanceUnavailableError)) throw err;
      logger.warn('Response filtering unavailable, using in-process scan only', { requestId: prep.requestId });
      prep.degraded.push('response_filtering');
      filteredResponse = scannedResponse;
    }

    await this.record(prep, filteredResponse, latencyMs);
    return filteredResponse;
  }

  /**
   * A streamed answer. Checks run first (a blocked request throws before anything is sent); the provider's
   * first chunk is awaited too, so provider errors also arrive as a normal error response. Personal data is
   * masked as text streams out, and the audit record is written when the stream ends or the client leaves.
   */
  async processStream(input: ProcessRequestInput, signal?: AbortSignal): Promise<{ requestId: string; parts: AsyncGenerator<StreamPart> }> {
    const prep = await this.prepare(input);
    const startTime = Date.now();
    const upstream = await this.providerRouter.stream(prep.protectedRequest, signal);
    const first = await upstream.next();
    const self = this;

    async function* parts(): AsyncGenerator<StreamPart> {
      const masker = new StreamMasker();
      let full = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let finishReason = 'stop';
      let completed = false;
      try {
        for (let r = first; !r.done; r = await upstream.next()) {
          const d = r.value;
          if (d.text) {
            full += d.text;
            const out = masker.push(d.text);
            if (out) yield { text: out };
          }
          if (d.inputTokens) inputTokens = d.inputTokens;
          if (d.outputTokens) outputTokens = d.outputTokens;
          if (d.finishReason) finishReason = d.finishReason;
        }
        const tail = masker.end();
        if (tail) yield { text: tail };
        completed = true;
        yield { done: true, finishReason, inputTokens, outputTokens };
      } finally {
        if (!completed) await upstream.return(undefined).catch(() => undefined);
        const response: NormalizedAIResponse = {
          requestId: prep.requestId,
          provider: prep.protectedRequest.provider,
          modelId: prep.protectedRequest.modelId,
          content: self.responseScanner.scan(full).maskedContent,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - startTime,
          finishReason: completed ? finishReason : 'client_disconnected',
          timestamp: new Date().toISOString(),
        };
        await self.record(prep, response, response.latencyMs, { streamed: 'true', ...(completed ? {} : { streamAbandoned: 'true' }) })
          .catch((err) => logger.error('Audit failed for streamed request', { requestId: prep.requestId, error: (err as Error).message }));
      }
    }
    return { requestId: prep.requestId, parts: parts() };
  }

  async getAvailableModels(tenantId: string) {
    return this.providerRouter.getModelsForTenant(tenantId);
  }
}
