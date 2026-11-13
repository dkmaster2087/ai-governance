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
import { checkPromptAttack, latestTurn, promptAttackBedrock, PromptAttackResult, PROMPT_ATTACK_RULE } from './prompt-attack';
import { ModelConfigRepository } from '../repositories/model-config.repository';

const logger = createLogger('gateway');

/** What a streamed answer yields to the route: text to send, then one final part. */
export type StreamPart = { text: string; done?: undefined } | { done: true; finishReason: string; inputTokens: number; outputTokens: number; text?: undefined };

interface ProcessRequestInput {
  tenantId: string;
  userId: string;
  appId: string;
  /** The API key making the request (absent for signed-in people). */
  keyId?: string;
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
  private models = new ModelConfigRepository();

  /**
   * Everything before the provider is called: policy evaluation on the original prompt, then personal-data
   * masking. Shared by normal and streamed requests, so a blocked request never starts a stream.
   */
  private async prepare(input: ProcessRequestInput) {
    const requestId = generateRequestId();
    const timestamp = new Date().toISOString();

    logger.info('Processing AI request', { requestId, tenantId: input.tenantId, model: input.model });

    // The company's settings for this model: which keys may use it, and the longest answer allowed.
    const model = (await this.models.forRequests(input.tenantId)).find((c) => c.modelId === input.model) ?? null;
    const limit = model?.maxTokensPerRequest;
    const maxTokens = limit ? Math.min(input.maxTokens ?? limit, limit) : input.maxTokens;

    const normalizedRequest: NormalizedAIRequest = {
      requestId,
      tenantId: input.tenantId,
      userId: input.userId,
      appId: input.appId,
      provider: this.providerRouter.resolveProvider(input.model),
      modelId: input.model,
      messages: input.messages,
      maxTokens,
      temperature: input.temperature,
      metadata: input.maxTokens && limit && input.maxTokens > limit ? { maxTokensCapped: `${input.maxTokens}→${limit}` } : {},
      timestamp,
      ...(input.keyId ? { apiKeyId: input.keyId } : {}),
    };

    if (model?.allowedKeyIds?.length && !(input.keyId && model.allowedKeyIds.includes(input.keyId))) {
      const reason = `This API key may not use ${model.name || input.model}; an admin can allow it on the Models page`;
      await this.auditService.log({ ...normalizedRequest, metadata: { ...normalizedRequest.metadata, check: 'model_keys' } }, null,
        { allowed: false, action: 'block', triggeredRules: [], riskScore: 0, reason }, 0);
      throw Object.assign(new Error(reason), { code: 'MODEL_NOT_ALLOWED', statusCode: 403, requestId });
    }

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
      // Only the cleaned messages come back from data protection; everything else stays as the gateway set it.
      protectedRequest = { ...afterSecrets, messages: masked.messages, metadata: { ...afterSecrets.metadata, ...masked.metadata } };
    } catch (err) {
      protectedRequest = whenUnavailable(err, 'pii_masking', afterSecrets);
    }

    // Check 4 (Beta): prompt attacks, on the cleaned text so no secret or personal data is sent to the check.
    // "flag" runs alongside the provider call and is recorded with the answer; "block" waits for the verdict.
    let promptAttack: Promise<PromptAttackResult> | null = null;
    const attackAction = await this.tenantSettings.getPromptAttackAction(input.tenantId);
    if (attackAction !== 'off') {
      promptAttack = checkPromptAttack(latestTurn(protectedRequest.messages), promptAttackBedrock());
      if (attackAction === 'block') {
        const verdict = await promptAttack;
        if (verdict.found && verdict.strong) {
          const reason = `Looks like a prompt attack: ${verdict.why}`;
          await this.auditService.log({ ...protectedRequest, metadata: { ...protectedRequest.metadata, ...verdict.metadata, check: 'prompt_attack' } }, null,
            { allowed: false, action: 'block', triggeredRules: [PROMPT_ATTACK_RULE], riskScore: 100, reason }, 0);
          throw Object.assign(new Error(`Request blocked: ${reason}.`), { code: 'PROMPT_ATTACK', statusCode: 403, requestId });
        }
      }
    }
    return { requestId, normalizedRequest: afterSecrets, protectedRequest, policyResult, degraded, promptAttack };
  }

  /** Case file for a request the provider refused or couldn't answer. */
  private async recordFailure(prep: Awaited<ReturnType<GatewayService['prepare']>>, err: unknown, latencyMs: number) {
    const reason = ((err as Error)?.message ?? 'no answer').replace(/\s+/g, ' ').slice(0, 200);
    const empty: NormalizedAIResponse = { requestId: prep.requestId, provider: prep.protectedRequest.provider, modelId: prep.protectedRequest.modelId, content: '', inputTokens: 0, outputTokens: 0, latencyMs, finishReason: 'error', timestamp: new Date().toISOString() };
    await this.record(prep, empty, latencyMs, { providerError: reason });
  }

  /** Audit record for a completed (or abandoned) request. */
  private async record(prep: Awaited<ReturnType<GatewayService['prepare']>>, response: NormalizedAIResponse, latencyMs: number, extra: Record<string, string> = {}) {
    const { normalizedRequest, policyResult, degraded } = prep;
    let protectedRequest = prep.protectedRequest;
    const attack = prep.promptAttack ? (await prep.promptAttack).metadata : {};
    const metadata = { ...protectedRequest.metadata, ...attack, ...extra, ...(degraded.length > 0 ? { governanceDegraded: degraded.join(',') } : {}) };
    protectedRequest = { ...protectedRequest, metadata };
    // PII was masked if the data protection service changed any message (secrets were already removed before it ran).
    const piiDetected = protectedRequest.messages.some((m, i) => m.content !== normalizedRequest.messages[i]?.content);
    await this.auditService.log(protectedRequest, response, policyResult, latencyMs, { piiDetected });
  }

  async processRequest(input: ProcessRequestInput): Promise<NormalizedAIResponse> {
    const prep = await this.prepare(input);

    const startTime = Date.now();
    let response: NormalizedAIResponse;
    try {
      response = await this.providerRouter.route(prep.protectedRequest);
    } catch (err) {
      // The prompt left for the provider (after the checks), so it still gets a case file, marked unanswered.
      await this.recordFailure(prep, err, Date.now() - startTime);
      throw err;
    }
    const latencyMs = Date.now() - startTime;

    // Scan the response for PII leakage (in-process)
    const scannedResponse = this.responseScanner.scanResponse(response, true);

    // Deeper response filtering via the data protection service. If it's down, the in-process
    // scan above has already masked the response, so continue and record it.
    let filteredResponse: NormalizedAIResponse;
    try {
      filteredResponse = await this.dataProtectionClient.filterResponse(scannedResponse, input.tenantId);
    } catch (err) {
      if (!(err instanceof GovernanceUnavailableError)) throw err;
      logger.warn('Response filtering unavailable, using in-process scan only', { requestId: prep.requestId });
      prep.degraded.push('response_filtering');
      filteredResponse = scannedResponse;
    }

    await this.record(prep, filteredResponse, latencyMs, filteredResponse.content !== response.content ? { answerPiiRemoved: 'true' } : {});
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
        const masked = self.responseScanner.scan(full).maskedContent;
        const response: NormalizedAIResponse = {
          requestId: prep.requestId,
          provider: prep.protectedRequest.provider,
          modelId: prep.protectedRequest.modelId,
          content: masked,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - startTime,
          finishReason: completed ? finishReason : 'client_disconnected',
          timestamp: new Date().toISOString(),
        };
        await self.record(prep, response, response.latencyMs, {
          streamed: 'true', ...(completed ? {} : { streamAbandoned: 'true' }), ...(masked !== full ? { answerPiiRemoved: 'true' } : {}),
        })
          .catch((err) => logger.error('Audit failed for streamed request', { requestId: prep.requestId, error: (err as Error).message }));
      }
    }
    return { requestId: prep.requestId, parts: parts() };
  }

  async getAvailableModels(tenantId: string) {
    return this.providerRouter.getModelsForTenant(tenantId);
  }
}
