import Fastify from 'fastify';
import { GovernanceUnavailableError } from '@ai-governance/utils';
import { PolicyEngineClient } from '../clients/policy-engine.client';
import { AuditService } from '../services/audit.service';

jest.mock('../clients/policy-engine.client');
jest.mock('../services/audit.service');
const mockFailMode = jest.fn();
const mockSecrets = jest.fn();
const mockAttack = jest.fn();
jest.mock('../services/tenant-settings.service', () => ({
  tenantSettings: () => ({
    getFailMode: (...a: unknown[]) => mockFailMode(...a),
    getSecretsAction: (...a: unknown[]) => mockSecrets(...a),
    getPromptAttackAction: (...a: unknown[]) => mockAttack(...a),
  }),
}));

const Policy = PolicyEngineClient as jest.MockedClass<typeof PolicyEngineClient>;
const Audit = AuditService as jest.MockedClass<typeof AuditService>;
const allow = { allowed: true, action: 'allow' as const, triggeredRules: [], riskScore: 0 };
const KEY = 'AKIAQ3EGRV7XKZ2PLM4N';

async function appWith(scopes: string[] = ['guardrails']) {
  const { guardrailsRoutes } = await import('../routes/guardrails.routes');
  const app = Fastify();
  app.decorateRequest('principal', null);
  app.addHook('preHandler', async (req: any) => {
    req.principal = { kind: 'api_key', tenantId: 'tenant_acme', keyId: 'k1', scopes, userId: 'anonymous', appId: 'litellm-key' };
    req.tenantId = 'tenant_acme';
    req.userId = 'anonymous';
    req.appId = 'litellm-key';
  });
  await app.register(guardrailsRoutes, { prefix: '/v1' });
  return app;
}

const LITELLM = '/v1/guardrails/litellm/beta/litellm_basic_guardrail_api';
const post = async (url: string, payload: unknown, scopes?: string[]) => (await appWith(scopes)).inject({ method: 'POST', url, payload: payload as any });
const audited = () => Audit.prototype.log.mock.calls;

describe('guardrails for other AI gateways', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Policy.prototype.evaluate.mockResolvedValue(allow);
    Audit.prototype.log.mockResolvedValue(undefined);
    mockFailMode.mockResolvedValue('closed');
    mockSecrets.mockResolvedValue('block');
    mockAttack.mockResolvedValue('off');
  });

  it('needs a key with the guardrails permission', async () => {
    const res = await post('/v1/guardrails/check', { text: 'hi' }, ['chat']);
    expect(res.statusCode).toBe(403);
    expect(Policy.prototype.evaluate).not.toHaveBeenCalled();
  });

  describe('LiteLLM', () => {
    const who = { user_api_key_alias: 'support-bot', user_api_key_end_user_id: 'jane@acme.com' };

    it('lets a clean prompt through and writes one case file naming LiteLLM, the app and the person', async () => {
      const res = await post(LITELLM, { texts: ['What is our refund policy?'], input_type: 'request', litellm_call_id: 'call_1', request_data: who });
      expect(res.json()).toEqual({ action: 'NONE' });
      expect(audited()).toHaveLength(1);
      const [req, response, result] = audited()[0];
      expect(req).toMatchObject({ appId: 'support-bot', userId: 'jane@acme.com', modelId: 'unknown' });
      expect(req.metadata).toMatchObject({ guardrail: 'litellm', guardrailPhase: 'prompt', guardrailCallId: 'call_1', modelUnknown: 'true' });
      expect(response).toMatchObject({ content: '[checked for another gateway]', inputTokens: 0 });
      expect(result.allowed).toBe(true);
    });

    it('returns cleaned texts in the same order when personal data is removed', async () => {
      const res = await post(LITELLM, { texts: ['Be brief.', 'My SSN is 123-45-6789'], input_type: 'request' });
      const body = res.json();
      expect(body.action).toBe('GUARDRAIL_INTERVENED');
      expect(body.texts[0]).toBe('Be brief.');
      expect(body.texts[1]).not.toContain('123-45-6789');
      expect(audited()[0][4]).toEqual({ piiDetected: true });
    });

    it('stops a prompt with a credential without echoing it', async () => {
      const res = await post(LITELLM, { texts: [`why does ${KEY} fail`], input_type: 'request' });
      const body = res.json();
      expect(body.action).toBe('BLOCKED');
      expect(body.blocked_reason).toContain('AWS access key');
      expect(JSON.stringify(body)).not.toContain(KEY);
      expect(audited()[0][2]).toMatchObject({ allowed: false });
    });

    it('removes a credential instead when the company chose "remove"', async () => {
      mockSecrets.mockResolvedValue('redact');
      const body = (await post(LITELLM, { texts: [`why does ${KEY} fail`], input_type: 'request' })).json();
      expect(body.action).toBe('GUARDRAIL_INTERVENED');
      expect(body.texts[0]).not.toContain(KEY);
    });

    it('stops a prompt a company rule stops', async () => {
      Policy.prototype.evaluate.mockResolvedValue({ allowed: false, action: 'block', triggeredRules: ['No project names'], riskScore: 90, reason: 'Mentions Project Falcon' });
      const body = (await post(LITELLM, { texts: ['Tell me about Project Falcon'], input_type: 'request' })).json();
      expect(body).toMatchObject({ action: 'BLOCKED', blocked_reason: expect.stringContaining('Mentions Project Falcon') });
    });

    it('stops the call when the rules cannot be checked and the company fails closed', async () => {
      Policy.prototype.evaluate.mockRejectedValue(new GovernanceUnavailableError('policy-engine'));
      const body = (await post(LITELLM, { texts: ['hello'], input_type: 'request' })).json();
      expect(body.action).toBe('BLOCKED');
    });

    it('lets it through, marked, when the company fails open', async () => {
      Policy.prototype.evaluate.mockRejectedValue(new GovernanceUnavailableError('policy-engine'));
      mockFailMode.mockResolvedValue('open');
      const body = (await post(LITELLM, { texts: ['hello'], input_type: 'request' })).json();
      expect(body.action).toBe('NONE');
      expect(audited()[0][0].metadata.governanceDegraded).toBe('policy_evaluation');
    });

    it('cleans an answer and records it; a clean answer adds no second case file', async () => {
      const clean = (await post(LITELLM, { texts: ['Refunds take 5 days.'], input_type: 'response', litellm_call_id: 'call_1' })).json();
      expect(clean).toEqual({ action: 'NONE' });
      expect(audited()).toHaveLength(0);
      const dirty = (await post(LITELLM, { texts: ['Call 555-123-4567 or email a@b.com'], input_type: 'response', litellm_call_id: 'call_1' })).json();
      expect(dirty.action).toBe('GUARDRAIL_INTERVENED');
      expect(dirty.texts[0]).not.toContain('a@b.com');
      expect(audited()).toHaveLength(1);
      expect(audited()[0][0].metadata).toMatchObject({ guardrailPhase: 'answer', answerPiiRemoved: 'true', guardrailCallId: 'call_1' });
    });
  });

  describe('Kong (allow or stop only)', () => {
    it('stops personal data it cannot hand back cleaned', async () => {
      const body = (await post('/v1/guardrails/kong', { input: 'My SSN is 123-45-6789' })).json();
      expect(body).toMatchObject({ block: true, code: 'PERSONAL_DATA', block_message: expect.stringContaining('personal data') });
      expect(JSON.stringify(body)).not.toContain('123-45-6789');
    });

    it('stops a credential even when the company chose "remove"', async () => {
      mockSecrets.mockResolvedValue('redact');
      const body = (await post('/v1/guardrails/kong', { input: `use ${KEY}` })).json();
      expect(body).toMatchObject({ block: true, code: 'SECRET_DETECTED' });
    });

    it('answers block when a check cannot run and the company fails closed', async () => {
      Policy.prototype.evaluate.mockRejectedValue(new GovernanceUnavailableError('policy-engine'));
      const res = await post('/v1/guardrails/kong', { input: 'hello' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ block: true, code: 'GOVERNANCE_UNAVAILABLE' });
    });

    it('allows a clean prompt', async () => {
      expect((await post('/v1/guardrails/kong', { input: 'hello', input_type: 'request' })).json()).toMatchObject({ block: false, action: 'allow' });
    });
  });

  describe('Portkey', () => {
    const chat = (content: unknown) => ({ model: 'gpt-4o', temperature: 0.2, messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content }] });

    it('rewrites only the message that changed, keeping the rest of the body', async () => {
      const res = await post('/v1/guardrails/portkey', { eventType: 'beforeRequestHook', request: { json: chat('My SSN is 123-45-6789') } });
      const body = res.json();
      expect(body.verdict).toBe(true);
      const json = body.transformedData.request.json;
      expect(json).toMatchObject({ model: 'gpt-4o', temperature: 0.2 });
      expect(json.messages[0]).toEqual({ role: 'system', content: 'Be brief.' });
      expect(json.messages[1].content).not.toContain('123-45-6789');
      expect(audited()[0][0]).toMatchObject({ modelId: 'gpt-4o' });
    });

    it('stops a prompt it would have to clean inside message parts', async () => {
      const body = (await post('/v1/guardrails/portkey', { eventType: 'beforeRequestHook', request: { json: chat([{ type: 'text', text: 'SSN 123-45-6789' }]) } })).json();
      expect(body.verdict).toBe(false);
      expect(body.transformedData).toBeUndefined();
    });

    it('returns verdict false for a stopped prompt', async () => {
      const body = (await post('/v1/guardrails/portkey', { eventType: 'beforeRequestHook', request: { json: chat(`key ${KEY}`) } })).json();
      expect(body.verdict).toBe(false);
    });

    it('cleans the answer in each choice', async () => {
      const response = { json: { id: 'cmpl', model: 'gpt-4o', choices: [{ index: 0, message: { role: 'assistant', content: 'Email jane@acme.com' }, finish_reason: 'stop' }] }, text: 'Email jane@acme.com' };
      const body = (await post('/v1/guardrails/portkey', { eventType: 'afterRequestHook', request: { json: chat('hi') }, response })).json();
      expect(body.verdict).toBe(true);
      const out = body.transformedData.response;
      expect(out.json.id).toBe('cmpl');
      expect(out.json.choices[0].message.content).not.toContain('jane@acme.com');
      expect(out.text).not.toContain('jane@acme.com');
    });
  });

  describe('Probaline format', () => {
    it('takes messages and gives cleaned messages back', async () => {
      const body = (await post('/v1/guardrails/check', { phase: 'prompt', model: 'gpt-4o', messages: [{ role: 'user', content: 'SSN 123-45-6789' }] })).json();
      expect(body).toMatchObject({ action: 'modify', block: false });
      expect(body.messages[0].content).not.toContain('123-45-6789');
      expect(body.requestId).toBeTruthy();
    });

    it('answers 503 when a check cannot run and the company fails closed', async () => {
      Policy.prototype.evaluate.mockRejectedValue(new GovernanceUnavailableError('policy-engine'));
      const res = await post('/v1/guardrails/check', { text: 'hello' });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('GOVERNANCE_UNAVAILABLE');
    });
  });
});
