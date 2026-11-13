import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAccess } from '../auth/guards';
import { GuardrailInput, GuardrailPhase, GuardrailResult, GuardrailService, GuardrailSource, GuardrailUnavailableError } from '../services/guardrail.service';
import { contentToText, extractMessages } from './proxy.routes';

/**
 * Probaline's checks as a guardrail for another AI gateway. Each gateway has its own format:
 *
 *   POST /v1/guardrails/check                                        Probaline's own (any HTTP guardrail hook)
 *   POST /v1/guardrails/kong                                         Kong AI Custom Guardrail (allow or stop only)
 *   POST /v1/guardrails/litellm/beta/litellm_basic_guardrail_api     LiteLLM Generic Guardrail API
 *   POST /v1/guardrails/portkey                                      Portkey webhook guardrail
 *
 * All need an API key with the `guardrails` permission. When a check can't run and the company fails closed,
 * each answers so its gateway stops the AI call: never "allowed" by default.
 */

const MAX_TEXTS = 1000;
const role = z.enum(['user', 'assistant', 'system', 'tool', 'developer', 'function']).transform((r) => (r === 'assistant' || r === 'system' ? r : 'user') as 'user' | 'assistant' | 'system');

/** "prompt" or "answer", from any of the names gateways use. */
function phaseOf(value: unknown): GuardrailPhase {
  return ['answer', 'response', 'output', 'post_call', 'afterRequestHook'].includes(String(value)) ? 'answer' : 'prompt';
}

const nativeBody = z.object({
  phase: z.string().optional(),
  input_type: z.string().optional(),
  messages: z.array(z.object({ role, content: z.unknown() })).max(MAX_TEXTS).optional(),
  text: z.string().optional(),
  input: z.string().optional(),
  texts: z.array(z.string()).max(MAX_TEXTS).optional(),
  model: z.string().max(200).optional(),
  callId: z.string().max(200).optional(),
  promptRequestId: z.string().max(100).optional(),
}).refine((b) => b.messages || b.texts || b.text !== undefined || b.input !== undefined, { message: 'Send messages, texts or text' });

const litellmBody = z.object({
  texts: z.array(z.string()).max(MAX_TEXTS).default([]),
  input_type: z.string().optional(),
  litellm_call_id: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  request_data: z.record(z.unknown()).optional(),
}).passthrough();

const portkeyBody = z.object({
  eventType: z.string().optional(),
  request: z.object({ json: z.unknown().optional(), text: z.string().optional() }).passthrough().optional(),
  response: z.object({ json: z.unknown().optional(), text: z.string().optional() }).passthrough().optional(),
  provider: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
}).passthrough();

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined);

export async function guardrailsRoutes(app: FastifyInstance) {
  const service = new GuardrailService();
  const access = { preHandler: requireAccess({ scopes: ['guardrails'] }) };

  const base = (request: FastifyRequest, source: GuardrailSource) => ({
    tenantId: request.tenantId,
    userId: request.userId,
    appId: request.appId,
    ...(request.principal?.kind === 'api_key' ? { keyId: request.principal.keyId } : {}),
    source,
  });

  /** Runs the checks; a check that can't run (company fails closed) comes back as `unavailable`. */
  async function run(input: GuardrailInput): Promise<{ result: GuardrailResult } | { unavailable: GuardrailUnavailableError }> {
    try {
      return { result: await service.check(input) };
    } catch (err) {
      if (err instanceof GuardrailUnavailableError) return { unavailable: err };
      throw err;
    }
  }

  // ── Probaline's own format, and Kong's (which can only allow or stop) ─────────────────────────────────────
  const native = (source: 'api' | 'kong') => async (request: FastifyRequest, reply: any) => {
    const body = nativeBody.parse(request.body);
    const messages = body.messages?.map((m) => ({ role: m.role, content: contentToText(m.content) }));
    const texts = messages ? messages.map((m) => m.content) : body.texts ?? [body.text ?? body.input ?? ''];
    const outcome = await run({
      ...base(request, source),
      phase: phaseOf(body.phase ?? body.input_type),
      texts,
      ...(messages ? { roles: messages.map((m) => m.role) } : {}),
      ...(body.model ? { model: body.model } : {}),
      ...(body.callId ? { callId: body.callId } : {}),
      ...(body.promptRequestId ? { promptRequestId: body.promptRequestId } : {}),
      blockOnly: source === 'kong',
    });
    if ('unavailable' in outcome) {
      const e = outcome.unavailable;
      // Kong reads the body only on success, so it gets a stop it can act on; others get a 503.
      if (source === 'kong') return reply.send({ block: true, block_message: e.message, action: 'block', code: e.code, requestId: e.requestId });
      return reply.status(503).send({ error: e.message, code: e.code, requestId: e.requestId });
    }
    const r = outcome.result;
    const changedBack = messages
      ? { messages: messages.map((m, i) => ({ role: m.role, content: r.texts[i] })) }
      : body.texts ? { texts: r.texts } : { text: r.texts[0] };
    return reply.send({
      requestId: r.requestId,
      action: r.decision,
      block: r.decision === 'block',
      ...(r.decision === 'block' ? { block_message: `Stopped by Probaline: ${r.reason}.`, reason: r.reason, code: r.code } : {}),
      triggeredRules: r.triggeredRules,
      ...(r.decision === 'modify' ? changedBack : {}),
    });
  };
  app.post('/guardrails/check', access, native('api'));
  app.post('/guardrails/kong', access, native('kong'));

  // ── LiteLLM Generic Guardrail API (api_base: <gateway>/v1/guardrails/litellm) ─────────────────────────────
  app.post('/guardrails/litellm/beta/litellm_basic_guardrail_api', access, async (request, reply) => {
    const body = litellmBody.parse(request.body);
    const who = body.request_data ?? {};
    const outcome = await run({
      ...base(request, 'litellm'),
      // LiteLLM's own key alias or team names the app; its end user or key user names the person.
      appId: str(who.user_api_key_alias) ?? str(who.user_api_key_team_alias) ?? request.appId,
      userId: str(who.user_api_key_end_user_id) ?? str(who.user_api_key_user_email) ?? str(who.user_api_key_user_id) ?? request.userId,
      phase: phaseOf(body.input_type),
      texts: body.texts,
      ...(str(body.model) ?? str(who.model) ? { model: (str(body.model) ?? str(who.model))! } : {}),
      ...(body.litellm_call_id ? { callId: body.litellm_call_id } : {}),
    });
    if ('unavailable' in outcome) return reply.send({ action: 'BLOCKED', blocked_reason: outcome.unavailable.message });
    const r = outcome.result;
    if (r.decision === 'block') return reply.send({ action: 'BLOCKED', blocked_reason: `Stopped by Probaline: ${r.reason} (request ${r.requestId})` });
    if (r.decision === 'modify') return reply.send({ action: 'GUARDRAIL_INTERVENED', texts: r.texts });
    return reply.send({ action: 'NONE' });
  });

  // ── Portkey webhook guardrail (before and after the model) ────────────────────────────────────────────────
  app.post('/guardrails/portkey', access, async (request, reply) => {
    const body = portkeyBody.parse(request.body);
    const phase = phaseOf(body.eventType);
    const meta = body.metadata ?? {};
    const who = { ...base(request, 'portkey'), userId: str(meta._user) ?? str(meta.user) ?? request.userId, appId: str(meta.app) ?? request.appId };
    const json = (phase === 'prompt' ? body.request?.json : body.response?.json) as any;
    const model = str(body.request?.json && (body.request.json as any).model) ?? str(json?.model);

    if (phase === 'prompt') {
      const messages = json ? extractMessages(json) : [{ role: 'user' as const, content: body.request?.text ?? '' }];
      const outcome = await run({ ...who, phase, texts: messages.map((m) => m.content), roles: messages.map((m) => m.role), ...(model ? { model } : {}) });
      if ('unavailable' in outcome) return reply.send({ verdict: false, reason: outcome.unavailable.message });
      const r = outcome.result;
      if (r.decision === 'block') return reply.send({ verdict: false, reason: `Stopped by Probaline: ${r.reason}`, requestId: r.requestId });
      if (r.decision === 'modify') {
        // Only a chat body can be rewritten in place; anything else that needed cleaning is stopped instead.
        const rewritten = json && Array.isArray(json.messages) && messages.length === json.messages.length + systemOffset(json)
          ? replaceMessageTexts(json, r) : null;
        if (rewritten) return reply.send({ verdict: true, requestId: r.requestId, transformedData: { request: { json: rewritten } } });
        return reply.send({ verdict: false, reason: 'Stopped by Probaline: the prompt needed cleaning, and its format can’t be rewritten', requestId: r.requestId });
      }
      return reply.send({ verdict: true, requestId: r.requestId });
    }

    // Answer: each choice's text checked on its own and put back in place.
    const choices: any[] = Array.isArray(json?.choices) ? json.choices : [];
    const texts = choices.length ? choices.map((c) => contentToText(c?.message?.content)) : [body.response?.text ?? ''];
    const outcome = await run({ ...who, phase, texts, ...(model ? { model } : {}) });
    if ('unavailable' in outcome) return reply.send({ verdict: false, reason: outcome.unavailable.message });
    const r = outcome.result;
    if (r.decision === 'block') return reply.send({ verdict: false, reason: `Stopped by Probaline: ${r.reason}`, requestId: r.requestId });
    if (r.decision === 'modify') {
      if (choices.some((c, i) => r.changed[i] && typeof c?.message?.content !== 'string')) {
        return reply.send({ verdict: false, reason: 'Stopped by Probaline: the answer needed cleaning, and its format can’t be rewritten', requestId: r.requestId });
      }
      const out = choices.length
        ? { ...json, choices: choices.map((c, i) => (r.changed[i] ? { ...c, message: { ...c.message, content: r.texts[i] } } : c)) }
        : json;
      return reply.send({ verdict: true, requestId: r.requestId, transformedData: { response: { json: out, text: r.texts.join('\n') } } });
    }
    return reply.send({ verdict: true, requestId: r.requestId });
  });
}

/**
 * The request body with changed message texts put back, or null when a changed message isn't plain text (parts,
 * tool results): rebuilding those could leave uncleaned text behind, so the caller stops the prompt instead.
 * `extractMessages` puts an Anthropic-style top-level `system` first, so indexes shift by one when present.
 */
/** 1 when `extractMessages` put a top-level system prompt first (it skips an empty one). */
function systemOffset(json: any): number {
  return json?.system !== undefined && contentToText(json.system) ? 1 : 0;
}

function replaceMessageTexts(json: any, r: GuardrailResult): any {
  const offset = systemOffset(json);
  if (offset && r.changed[0] && typeof json.system !== 'string') return null;
  if (json.messages.some((m: any, i: number) => r.changed[i + offset] && typeof m?.content !== 'string')) return null;
  return {
    ...json,
    ...(offset && r.changed[0] ? { system: r.texts[0] } : {}),
    messages: json.messages.map((m: any, i: number) => (r.changed[i + offset] ? { ...m, content: r.texts[i + offset] } : m)),
  };
}
