import { NormalizedAIRequest, PolicyEvaluationResult } from '@ai-governance/types';
import { generateRequestId, createLogger, GovernanceUnavailableError } from '@ai-governance/utils';
import { PolicyEngineClient } from '../clients/policy-engine.client';
import { PIIDetectionService } from '../data-protection/pii-detection.service';
import { AuditService } from './audit.service';
import { tenantSettings } from './tenant-settings.service';
import { checkSecrets, SECRETS_RULE } from './secrets-check';
import { checkPromptAttack, latestTurn, promptAttackBedrock, PromptAttackResult, PROMPT_ATTACK_RULE } from './prompt-attack';

/**
 * Probaline's checks for another AI gateway (LiteLLM, Portkey, Kong, or anything that calls an HTTP guardrail).
 * That gateway calls the model itself; Probaline checks the prompt before it leaves and the answer before it
 * reaches the person, and keeps the case file. Same checks, order and fail mode as the app endpoint.
 */

const logger = createLogger('gateway:guardrails');

/** Which gateway asked: recorded on the case file. */
export type GuardrailSource = 'api' | 'litellm' | 'portkey' | 'kong';
export type GuardrailPhase = 'prompt' | 'answer';
type Role = 'user' | 'assistant' | 'system';

/** Rule name recorded when personal data stops a check whose caller can't take back cleaned text (Kong). */
export const PERSONAL_DATA_RULE = 'Personal data';

export interface GuardrailInput {
  tenantId: string;
  userId: string;
  appId: string;
  keyId?: string;
  source: GuardrailSource;
  phase: GuardrailPhase;
  /** The texts to check, in the caller's order; changed texts come back in the same order. */
  texts: string[];
  /** Role of each text (prompt default: user; answer: assistant). */
  roles?: Role[];
  /** The model the other gateway is calling, when it says. Model rules apply only when it does. */
  model?: string;
  /** The other gateway's ID for this AI call, so the prompt and answer case files can be matched. */
  callId?: string;
  /** For an answer: the Probaline request ID of the prompt check. */
  promptRequestId?: string;
  /** The caller can only allow or block (Kong): anything Probaline would remove stops the call instead. */
  blockOnly?: boolean;
}

export type GuardrailDecision = 'allow' | 'modify' | 'block';

export interface GuardrailResult {
  requestId: string;
  decision: GuardrailDecision;
  /** Why it was stopped (block only). Never contains the secret or personal data itself. */
  reason?: string;
  code?: 'POLICY_VIOLATION' | 'SECRET_DETECTED' | 'PERSONAL_DATA' | 'PROMPT_ATTACK';
  triggeredRules: string[];
  /** The texts after the checks: secrets and personal data removed (equal to the input when nothing changed). */
  texts: string[];
  /** Which texts changed. */
  changed: boolean[];
}

/** A check that couldn't run and the company fails closed: the caller should refuse the AI call (503). */
export class GuardrailUnavailableError extends Error {
  statusCode = 503;
  code = 'GOVERNANCE_UNAVAILABLE';
  constructor(public requestId: string) {
    super('Probaline could not run its checks, and this company stops AI requests when that happens');
  }
}

/** The answer-side record for a gateway that called the model itself: no tokens, no cost, no content. */
const CHECKED_ELSEWHERE = '[checked for another gateway]';

export class GuardrailService {
  private policy = new PolicyEngineClient();
  private pii = new PIIDetectionService();
  private audit = new AuditService();
  private settings = tenantSettings();

  async check(input: GuardrailInput): Promise<GuardrailResult> {
    return input.phase === 'prompt' ? this.checkPrompt(input) : this.checkAnswer(input);
  }

  private request(input: GuardrailInput, requestId: string, texts: string[], metadata: Record<string, string>): NormalizedAIRequest {
    const fallbackRole: Role = input.phase === 'prompt' ? 'user' : 'assistant';
    return {
      requestId,
      tenantId: input.tenantId,
      userId: input.userId,
      appId: input.appId,
      provider: 'external' as NormalizedAIRequest['provider'],
      modelId: input.model || 'unknown',
      messages: texts.map((content, i) => ({ role: input.roles?.[i] ?? fallbackRole, content })),
      metadata: {
        guardrail: input.source,
        guardrailPhase: input.phase,
        ...(input.callId ? { guardrailCallId: input.callId.slice(0, 200) } : {}),
        ...(input.promptRequestId ? { guardrailPromptId: input.promptRequestId.slice(0, 100) } : {}),
        ...(input.model ? {} : { modelUnknown: 'true' }),
        ...metadata,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private blocked(requestId: string, texts: string[], code: GuardrailResult['code'], reason: string, rules: string[]): GuardrailResult {
    return { requestId, decision: 'block', code, reason, triggeredRules: rules, texts, changed: texts.map(() => false) };
  }

  /** Personal data removed from each text; on failure, the company's fail mode decides. */
  private async mask(texts: string[], tenantId: string, requestId: string, degraded: string[]): Promise<string[]> {
    try {
      return await Promise.all(texts.map((t) => this.pii.maskText(t)));
    } catch (err) {
      if ((await this.settings.getFailMode(tenantId)) !== 'open') throw new GuardrailUnavailableError(requestId);
      logger.warn('Personal data check skipped (tenant fails open)', { requestId, tenantId, error: (err as Error).message });
      degraded.push('pii_masking');
      return texts;
    }
  }

  private async checkPrompt(input: GuardrailInput): Promise<GuardrailResult> {
    const requestId = generateRequestId();
    const original = this.request(input, requestId, input.texts, {});
    const degraded: string[] = [];

    // Check 1: company rules, on the original text so rules that look for personal data see it.
    let policy: PolicyEvaluationResult;
    try {
      policy = await this.policy.evaluate(original);
    } catch (err) {
      if (!(err instanceof GovernanceUnavailableError) || (await this.settings.getFailMode(input.tenantId)) !== 'open') {
        throw new GuardrailUnavailableError(requestId);
      }
      degraded.push('policy_evaluation');
      policy = { allowed: true, action: 'allow', triggeredRules: [], riskScore: 0, reason: 'Policy engine unavailable (tenant fails open)' };
    }
    if (!policy.allowed) {
      await this.audit.log(original, null, policy, 0);
      return this.blocked(requestId, input.texts, 'POLICY_VIOLATION', policy.reason || 'Blocked by a company rule', policy.triggeredRules);
    }

    // Check 2: credentials. A caller that can't take back cleaned text gets "stop" instead of "remove".
    const configured = await this.settings.getSecretsAction(input.tenantId);
    const secrets = checkSecrets(original.messages, input.blockOnly && configured === 'redact' ? 'block' : configured);
    const metadata: Record<string, string> = { ...secrets.metadata };
    if (secrets.outcome === 'blocked') {
      await this.audit.log({ ...original, metadata: { ...original.metadata, ...metadata } }, null, secrets.result, 0);
      return this.blocked(requestId, input.texts, 'SECRET_DETECTED', secrets.result.reason || 'Contains a credential', [SECRETS_RULE]);
    }
    let texts = secrets.outcome === 'redacted' ? secrets.messages.map((m) => m.content) : input.texts;

    // Check 3: personal data.
    const masked = await this.mask(texts, input.tenantId, requestId, degraded);
    const piiDetected = masked.some((t, i) => t !== texts[i]);
    if (piiDetected && input.blockOnly) {
      const reason = 'Contains personal data, and this gateway can only allow or stop a prompt, not send a cleaned one';
      await this.audit.log({ ...original, metadata: { ...original.metadata, ...metadata, check: 'personal_data' } }, null,
        { allowed: false, action: 'block', triggeredRules: [PERSONAL_DATA_RULE], riskScore: 80, reason }, 0);
      return this.blocked(requestId, input.texts, 'PERSONAL_DATA', reason, [PERSONAL_DATA_RULE]);
    }
    texts = masked;

    // Check 4 (Beta): prompt attacks, on the cleaned text. "flag" doesn't hold the call up; it's recorded when ready.
    let attack: Promise<PromptAttackResult> | null = null;
    const attackAction = await this.settings.getPromptAttackAction(input.tenantId);
    if (attackAction !== 'off') {
      const cleaned = this.request(input, requestId, texts, {});
      attack = checkPromptAttack(latestTurn(cleaned.messages), promptAttackBedrock());
      if (attackAction === 'block') {
        const verdict = await attack;
        if (verdict.found && verdict.strong) {
          const reason = `Looks like a prompt attack: ${verdict.why}`;
          await this.audit.log({ ...cleaned, metadata: { ...cleaned.metadata, ...metadata, ...verdict.metadata, check: 'prompt_attack' } }, null,
            { allowed: false, action: 'block', triggeredRules: [PROMPT_ATTACK_RULE], riskScore: 100, reason }, 0);
          return this.blocked(requestId, input.texts, 'PROMPT_ATTACK', reason, [PROMPT_ATTACK_RULE]);
        }
      }
    }

    const changed = texts.map((t, i) => t !== input.texts[i]);
    const record = async () => {
      const verdict = attack ? (await attack).metadata : {};
      const req = this.request(input, requestId, texts, {
        ...metadata, ...verdict, ...(degraded.length ? { governanceDegraded: degraded.join(',') } : {}),
      });
      await this.audit.log(req,
        { requestId, provider: req.provider, modelId: req.modelId, content: CHECKED_ELSEWHERE, inputTokens: 0, outputTokens: 0, latencyMs: 0, finishReason: 'stop', timestamp: req.timestamp },
        policy, 0, { piiDetected });
    };
    // With a flag-only attack check pending, answer now and write the case file when the verdict arrives.
    if (attack && attackAction === 'flag') record().catch((err) => logger.error('Guardrail audit failed', { requestId, error: (err as Error).message }));
    else await record();

    return { requestId, decision: changed.some(Boolean) ? 'modify' : 'allow', triggeredRules: policy.triggeredRules, texts, changed };
  }

  /**
   * The model's answer: credentials and personal data removed (or the answer stopped). A case file is written
   * only when something is removed or stopped, so an AI call isn't counted twice on the dashboard.
   */
  private async checkAnswer(input: GuardrailInput): Promise<GuardrailResult> {
    const requestId = generateRequestId();
    const original = this.request(input, requestId, input.texts, {});
    const degraded: string[] = [];

    const configured = await this.settings.getSecretsAction(input.tenantId);
    const secrets = checkSecrets(original.messages, input.blockOnly && configured === 'redact' ? 'block' : configured);
    if (secrets.outcome === 'blocked') {
      const reason = (secrets.result.reason || 'Contains a credential').replace(/^Contains/, 'The answer contains');
      await this.audit.log({ ...original, metadata: { ...original.metadata, ...secrets.metadata } }, null, { ...secrets.result, reason }, 0);
      return this.blocked(requestId, input.texts, 'SECRET_DETECTED', reason, [SECRETS_RULE]);
    }
    const afterSecrets = secrets.outcome === 'redacted' ? secrets.messages.map((m) => m.content) : input.texts;
    const texts = await this.mask(afterSecrets, input.tenantId, requestId, degraded);
    const piiRemoved = texts.some((t, i) => t !== afterSecrets[i]);

    if (piiRemoved && input.blockOnly) {
      const reason = 'The answer contains personal data, and this gateway can only allow or stop an answer, not send a cleaned one';
      await this.audit.log({ ...original, metadata: { ...original.metadata, ...secrets.metadata, check: 'personal_data' } }, null,
        { allowed: false, action: 'block', triggeredRules: [PERSONAL_DATA_RULE], riskScore: 80, reason }, 0);
      return this.blocked(requestId, input.texts, 'PERSONAL_DATA', reason, [PERSONAL_DATA_RULE]);
    }

    const changed = texts.map((t, i) => t !== input.texts[i]);
    if (changed.some(Boolean) || degraded.length) {
      const req = this.request(input, requestId, texts, {
        ...secrets.metadata,
        ...(piiRemoved ? { answerPiiRemoved: 'true' } : {}),
        ...(degraded.length ? { governanceDegraded: degraded.join(',') } : {}),
      });
      await this.audit.log(req,
        { requestId, provider: req.provider, modelId: req.modelId, content: texts.join('\n'), inputTokens: 0, outputTokens: 0, latencyMs: 0, finishReason: 'stop', timestamp: req.timestamp },
        { allowed: true, action: 'allow', triggeredRules: [], riskScore: 0 }, 0);
    }
    return { requestId, decision: changed.some(Boolean) ? 'modify' : 'allow', triggeredRules: [], texts, changed };
  }
}
