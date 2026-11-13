import { FastifyInstance } from 'fastify';
import axios from 'axios';
import { generateRequestId, createLogger, GovernanceUnavailableError } from '@ai-governance/utils';
import { NormalizedAIRequest, PolicyEvaluationResult } from '@ai-governance/types';
import { PolicyEngineClient } from '../clients/policy-engine.client';
import { AuditService } from '../services/audit.service';
import { requireAccess } from '../auth/guards';
import { tenantSettings } from '../services/tenant-settings.service';
import { checkSecrets } from '../services/secrets-check';
import { checkPromptAttack, latestTurn, promptAttackBedrock, PromptAttackResult, PROMPT_ATTACK_RULE } from '../services/prompt-attack';
import { redactDeep } from '../services/secret-detector';
import { maskPromptFields } from '../services/proxy-pii';
import { PIIDetectionService } from '../data-protection/pii-detection.service';

const logger = createLogger('gateway:proxy');
const policyClient = new PolicyEngineClient();
const auditService = new AuditService();
const pii = new PIIDetectionService();
const settings = tenantSettings();

/** Known AI provider targets — maps a slug to the real base URL */
const PROVIDER_TARGETS: Record<string, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  cohere: 'https://api.cohere.ai',
  mistral: 'https://api.mistral.ai',
};

type Role = 'user' | 'assistant' | 'system';

/**
 * Flatten message content to text. Providers accept either a string or an array of content blocks
 * (e.g. [{ type: 'text', text }, { type: 'image', ... }, { type: 'tool_result', content: [...] }]).
 */
export function contentToText(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(contentToText).filter(Boolean).join('\n');
  if (typeof content === 'object') {
    const block = content as Record<string, unknown>;
    if (typeof block.text === 'string') return block.text;
    if (block.content !== undefined) return contentToText(block.content);
    if (block.input !== undefined) return contentToText(typeof block.input === 'string' ? block.input : JSON.stringify(block.input));
    return '';
  }
  return String(content);
}

/** Extract the text a policy should see from the common AI provider request formats. */
export function extractMessages(body: any): { role: Role; content: string }[] {
  const out: { role: Role; content: string }[] = [];
  // Anthropic Messages API puts the system prompt at the top level
  if (body?.system !== undefined) {
    const system = contentToText(body.system);
    if (system) out.push({ role: 'system', content: system });
  }
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) {
      const role: Role = m?.role === 'assistant' || m?.role === 'system' ? m.role : 'user';
      out.push({ role, content: contentToText(m?.content) });
    }
    return out;
  }
  // Legacy completions / single-field formats
  for (const field of ['prompt', 'input', 'content', 'message']) {
    if (body?.[field] !== undefined) {
      out.push({ role: 'user', content: contentToText(body[field]) });
      return out;
    }
  }
  return out;
}

function extractModel(body: any): string {
  return body?.model || body?.model_id || 'unknown';
}

export async function proxyRoutes(app: FastifyInstance) {

  /**
   * Transparent proxy endpoint.
   * 
   * Usage: POST /v1/proxy/:provider/*
   * Example: POST /v1/proxy/openai/v1/chat/completions
   * 
   * The client sends the exact same request they'd send to the AI provider,
   * but through Probaline. Probaline inspects, governs, logs, and forwards.
   * The client's own Authorization header is forwarded to the provider.
   */
  app.all('/proxy/:provider/*', { preHandler: requireAccess({ scopes: ['chat'] }) }, async (request, reply) => {
    const provider = (request.params as any).provider as string;
    const path = (request.params as any)['*'] as string;
    // PROXY_TARGET_<PROVIDER> points a known provider elsewhere (local mock, private endpoint); set by the operator only.
    const slug = provider.toLowerCase();
    const targetBase = PROVIDER_TARGETS[slug] && (process.env[`PROXY_TARGET_${slug.toUpperCase()}`] || PROVIDER_TARGETS[slug]);

    if (!targetBase) {
      return reply.status(400).send({
        error: 'Unknown provider',
        code: 'UNKNOWN_PROVIDER',
        supported: Object.keys(PROVIDER_TARGETS),
      });
    }

    const requestId = generateRequestId();
    const tenantId = request.tenantId;
    const userId = request.userId;
    let body = request.body as any;
    const targetUrl = `${targetBase}/${path}`;

    logger.info('Proxy request', { requestId, tenantId, provider, path: '/' + path, model: extractModel(body) });

    // --- 1. Extract prompt for policy evaluation ---
    let messages = extractMessages(body);
    const modelId = extractModel(body);
    const auditMetadata: Record<string, string> = { proxyMode: 'true' };
    /** Whether personal data was removed from the prompt (check 3). */
    let piiDetected = false;
    /** The prompt-attack verdict (Beta), added to the audit record when it's written. */
    let promptAttack: Promise<PromptAttackResult> | null = null;
    const withAttack = async () => (promptAttack ? { ...auditMetadata, ...(await promptAttack).metadata } : auditMetadata);

    if (messages.length > 0) {
      const normalizedRequest: NormalizedAIRequest = {
        requestId,
        tenantId,
        userId,
        appId: request.appId || 'proxy',
        provider: provider as any,
        modelId,
        messages,
        metadata: { proxyMode: 'true' },
        timestamp: new Date().toISOString(),
        ...(request.principal?.kind === 'api_key' ? { apiKeyId: request.principal.keyId } : {}),
      };

      // --- 2. Policy evaluation (respecting the tenant's fail mode if the engine is down) ---
      let policyResult: PolicyEvaluationResult;
      try {
        policyResult = await policyClient.evaluate(normalizedRequest);
      } catch (err) {
        if (!(err instanceof GovernanceUnavailableError) || (await settings.getFailMode(tenantId)) !== 'open') {
          logger.error('Proxy request blocked: policy engine unavailable', { requestId, tenantId });
          return reply.status(503).send({ error: 'Governance check unavailable', code: 'GOVERNANCE_UNAVAILABLE', requestId });
        }
        logger.warn('Policy check skipped (tenant fails open)', { requestId, tenantId });
        auditMetadata.governanceDegraded = 'policy_evaluation';
        policyResult = { allowed: true, action: 'allow', triggeredRules: [], riskScore: 0 };
      }

      if (!policyResult.allowed) {
        logger.info('Proxy request blocked by policy', { requestId, tenantId, reason: policyResult.reason });
        await auditService.log(normalizedRequest, null, policyResult, 0);
        return reply.status(403).send({
          error: policyResult.reason || 'Request blocked by policy',
          code: 'POLICY_VIOLATION',
          requestId,
          triggeredRules: policyResult.triggeredRules,
        });
      }

      // --- 2b. Secrets: stop the request, or strip them from the body before it's forwarded ---
      const secrets = checkSecrets(messages, await settings.getSecretsAction(tenantId));
      Object.assign(auditMetadata, secrets.metadata);
      if (secrets.outcome === 'blocked') {
        logger.info('Proxy request blocked: secret in prompt', { requestId, tenantId, types: secrets.metadata.secretTypes });
        await auditService.log({ ...normalizedRequest, metadata: { ...auditMetadata } }, null, secrets.result, 0);
        return reply.status(403).send({ error: secrets.message, code: 'SECRET_DETECTED', requestId, triggeredRules: secrets.result.triggeredRules });
      }
      if (secrets.outcome === 'redacted') {
        body = redactDeep(body).value;
        messages = extractMessages(body);
      }

      // --- 2b'. Personal data: removed from the prompt text before it leaves, as on the app endpoint ---
      try {
        const masked = await maskPromptFields(body, (t) => pii.maskText(t));
        if (masked.changed) {
          body = masked.body;
          messages = extractMessages(body);
          piiDetected = true;
        }
      } catch (err) {
        if ((await settings.getFailMode(tenantId)) !== 'open') {
          logger.error('Proxy request blocked: personal data check failed', { requestId, tenantId });
          return reply.status(503).send({ error: 'Governance check unavailable', code: 'GOVERNANCE_UNAVAILABLE', requestId });
        }
        auditMetadata.governanceDegraded = [auditMetadata.governanceDegraded, 'pii_masking'].filter(Boolean).join(',');
      }

      // --- 2c. Prompt attacks (Beta): "flag" is recorded with the answer; "block" waits for the verdict ---
      const attackAction = await settings.getPromptAttackAction(tenantId);
      if (attackAction !== 'off') {
        promptAttack = checkPromptAttack(latestTurn(messages), promptAttackBedrock());
        const verdict = attackAction === 'block' ? await promptAttack : null;
        if (verdict?.found && verdict.strong) {
          const reason = `Looks like a prompt attack: ${verdict.why}`;
          await auditService.log({ ...normalizedRequest, metadata: { ...auditMetadata, ...verdict.metadata, check: 'prompt_attack' } }, null,
            { allowed: false, action: 'block', triggeredRules: [PROMPT_ATTACK_RULE], riskScore: 100, reason }, 0);
          return reply.status(403).send({ error: `Request blocked: ${reason}.`, code: 'PROMPT_ATTACK', requestId, triggeredRules: [PROMPT_ATTACK_RULE] });
        }
      }
    }

    // --- 3. Forward to real provider ---
    // Pass through the client's original headers (including their auth)
    const forwardHeaders: Record<string, string> = {};
    const passthroughHeaders = ['authorization', 'content-type', 'x-api-key', 'anthropic-version', 'anthropic-beta'];
    for (const h of passthroughHeaders) {
      const val = request.headers[h];
      if (val) forwardHeaders[h] = Array.isArray(val) ? val[0] : val;
    }

    const startTime = Date.now();

    // Streaming (IDEs ask for it): the request was checked above; pass the provider's stream straight through
    // and read token counts from it on the way past for the audit record.
    if (body?.stream === true) {
      let upstream;
      try {
        upstream = await axios({
          method: request.method as any, url: targetUrl, data: body, headers: forwardHeaders,
          timeout: 120000, responseType: 'stream', validateStatus: () => true,
        });
      } catch (err: any) {
        logger.error('Proxy forward failed', { requestId, tenantId, error: err.message });
        return reply.status(502).send({ error: 'Failed to reach AI provider', code: 'PROXY_ERROR', requestId, detail: err.message });
      }
      reply.hijack();
      const res = reply.raw;
      res.writeHead(upstream.status, {
        ...(reply.getHeaders() as Record<string, string>),
        'content-type': String(upstream.headers['content-type'] ?? 'text/event-stream'),
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
        'x-probaline-request-id': requestId,
      });
      const usage = { input: 0, output: 0 };
      let pending = '';
      upstream.data.on('data', (chunk: Buffer) => {
        pending += chunk.toString('utf8');
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:') || !line.includes('usage')) continue;
          try {
            const e = JSON.parse(line.slice(5));
            const u = e.usage ?? e.message?.usage;
            if (u) {
              usage.input = u.prompt_tokens ?? u.input_tokens ?? usage.input;
              usage.output = u.completion_tokens ?? u.output_tokens ?? usage.output;
            }
          } catch { /* not JSON */ }
        }
      });
      res.on('close', () => upstream.data.destroy());
      upstream.data.pipe(res);
      upstream.data.on('close', async () => {
        const latencyMs = Date.now() - startTime;
        if (messages.length === 0) return;
        const auditReq: NormalizedAIRequest = {
          requestId, tenantId, userId, appId: request.appId || 'proxy', provider: provider as any, modelId, messages,
          metadata: { ...(await withAttack()), streamed: 'true' }, timestamp: new Date().toISOString(),
        };
        auditService.log(
          auditReq,
          { requestId, content: '[proxy passthrough]', inputTokens: usage.input, outputTokens: usage.output, latencyMs, provider: provider as any, modelId, finishReason: 'stop', timestamp: new Date().toISOString() },
          { allowed: true, action: 'allow', triggeredRules: [], riskScore: 0 },
          latencyMs,
          { piiDetected },
        ).catch((err) => logger.error('Proxy audit failed', { requestId, error: (err as Error).message }));
      });
      return;
    }

    try {
      const providerResponse = await axios({
        method: request.method as any,
        url: targetUrl,
        data: body,
        headers: forwardHeaders,
        timeout: 120000,
        validateStatus: () => true, // Don't throw on 4xx/5xx — forward as-is
      });

      const latencyMs = Date.now() - startTime;

      // --- 4. Log to audit ---
      if (messages.length > 0) {
        // OpenAI reports prompt/completion tokens; Anthropic reports input/output tokens.
        const usage = providerResponse.data?.usage ?? {};
        const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
        const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
        const auditReq: NormalizedAIRequest = {
          requestId, tenantId, userId, appId: request.appId || 'proxy',
          provider: provider as any, modelId, messages,
          metadata: await withAttack(), timestamp: new Date().toISOString(),
        };
        await auditService.log(
          auditReq,
          { requestId, content: '[proxy passthrough]', inputTokens, outputTokens, latencyMs, provider: provider as any, modelId, finishReason: 'stop', timestamp: new Date().toISOString() },
          { allowed: true, action: 'allow', triggeredRules: [], riskScore: 0 },
          latencyMs,
          { piiDetected },
        );
      }

      logger.info('Proxy response', { requestId, tenantId, status: providerResponse.status, latencyMs });

      // --- 5. Return provider response to client ---
      return reply
        .status(providerResponse.status)
        .headers({ 'x-probaline-request-id': requestId, 'x-probaline-latency-ms': String(Date.now() - startTime) })
        .send(providerResponse.data);

    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Proxy forward failed', { requestId, tenantId, error: err.message, latencyMs });
      return reply.status(502).send({
        error: 'Failed to reach AI provider',
        code: 'PROXY_ERROR',
        requestId,
        detail: err.message,
      });
    }
  });

  /** List supported proxy providers */
  app.get('/proxy/providers', { preHandler: requireAccess({ roles: ['tenant_admin', 'tenant_auditor', 'tenant_user'], scopes: ['chat'] }) }, async () => ({
    providers: Object.keys(PROVIDER_TARGETS),
    usage: 'POST /v1/proxy/:provider/<original-api-path>',
    example: 'POST /v1/proxy/openai/v1/chat/completions',
  }));
}
