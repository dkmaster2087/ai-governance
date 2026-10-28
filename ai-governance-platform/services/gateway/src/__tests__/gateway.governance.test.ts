import { GovernanceUnavailableError } from '@ai-governance/utils';
import { GatewayService } from '../services/gateway.service';
import { PolicyEngineClient } from '../clients/policy-engine.client';
import { DataProtectionClient } from '../clients/data-protection.client';
import { ProviderRouter } from '../services/provider.router';
import { AuditService } from '../services/audit.service';
import { extractMessages } from '../routes/proxy.routes';

jest.mock('../clients/policy-engine.client');
jest.mock('../clients/data-protection.client');
jest.mock('../services/provider.router');
jest.mock('../services/audit.service');
const mockGetFailMode = jest.fn();
jest.mock('../services/tenant-settings.service', () => ({
  tenantSettings: () => ({ getFailMode: (...args: unknown[]) => mockGetFailMode(...args) }),
}));

const Policy = PolicyEngineClient as jest.MockedClass<typeof PolicyEngineClient>;
const DataProtection = DataProtectionClient as jest.MockedClass<typeof DataProtectionClient>;
const Router = ProviderRouter as jest.MockedClass<typeof ProviderRouter>;
const Audit = AuditService as jest.MockedClass<typeof AuditService>;

const input = {
  tenantId: 'tenant_acme', userId: 'u1', appId: 'app',
  model: 'anthropic.claude-3-haiku-20240307-v1:0',
  messages: [{ role: 'user' as const, content: 'My SSN is 123-45-6789' }],
};
const providerResponse = {
  requestId: 'r', provider: 'bedrock' as const, modelId: input.model, content: 'ok',
  inputTokens: 1, outputTokens: 1, latencyMs: 1, finishReason: 'stop', timestamp: '',
};
const allow = { allowed: true, action: 'allow' as const, triggeredRules: [], riskScore: 0 };

describe('GatewayService governance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Router.prototype.resolveProvider.mockReturnValue('bedrock');
    Router.prototype.route.mockResolvedValue(providerResponse);
    DataProtection.prototype.protectRequest.mockImplementation(async (r) => ({
      ...r, messages: r.messages.map((m) => ({ ...m, content: m.content.replace(/\d{3}-\d{2}-\d{4}/, '[REDACTED]') })),
    }));
    DataProtection.prototype.filterResponse.mockImplementation(async (r) => r);
    Policy.prototype.evaluate.mockResolvedValue(allow);
    Audit.prototype.log.mockResolvedValue(undefined);
    mockGetFailMode.mockResolvedValue('closed');
  });

  it('evaluates policy on the original prompt and sends only the masked prompt to the provider', async () => {
    await new GatewayService().processRequest(input);
    expect(Policy.prototype.evaluate.mock.calls[0][0].messages[0].content).toContain('123-45-6789');
    expect(Router.prototype.route.mock.calls[0][0].messages[0].content).toBe('My SSN is [REDACTED]');
  });

  it('does not mask or call the provider when policy blocks', async () => {
    Policy.prototype.evaluate.mockResolvedValue({ allowed: false, action: 'block', triggeredRules: ['pii'], riskScore: 100, reason: 'PII' });
    await expect(new GatewayService().processRequest(input)).rejects.toMatchObject({ statusCode: 403 });
    expect(Router.prototype.route).not.toHaveBeenCalled();
  });

  describe('fail closed (default)', () => {
    it('blocks when the policy engine is down', async () => {
      Policy.prototype.evaluate.mockRejectedValue(new GovernanceUnavailableError('policy-engine'));
      await expect(new GatewayService().processRequest(input)).rejects.toMatchObject({ statusCode: 503, code: 'GOVERNANCE_UNAVAILABLE' });
      expect(Router.prototype.route).not.toHaveBeenCalled();
    });

    it('blocks rather than sending an unmasked prompt when data protection is down', async () => {
      DataProtection.prototype.protectRequest.mockRejectedValue(new GovernanceUnavailableError('data-protection'));
      await expect(new GatewayService().processRequest(input)).rejects.toMatchObject({ statusCode: 503 });
      expect(Router.prototype.route).not.toHaveBeenCalled();
    });
  });

  describe('fail open (tenant opt-in)', () => {
    beforeEach(() => mockGetFailMode.mockResolvedValue('open'));

    it('continues and flags the audit record when the policy engine is down', async () => {
      Policy.prototype.evaluate.mockRejectedValue(new GovernanceUnavailableError('policy-engine'));
      await new GatewayService().processRequest(input);
      expect(Router.prototype.route).toHaveBeenCalled();
      const auditedRequest = Audit.prototype.log.mock.calls[0][0];
      expect(auditedRequest.metadata.governanceDegraded).toBe('policy_evaluation');
    });

    it('does not swallow unexpected errors', async () => {
      Policy.prototype.evaluate.mockRejectedValue(new Error('bug'));
      await expect(new GatewayService().processRequest(input)).rejects.toThrow('bug');
    });
  });

  it('falls back to the in-process response scan when response filtering is down', async () => {
    DataProtection.prototype.filterResponse.mockRejectedValue(new GovernanceUnavailableError('data-protection'));
    const result = await new GatewayService().processRequest(input);
    expect(result.content).toBe('ok');
    expect(Audit.prototype.log.mock.calls[0][0].metadata.governanceDegraded).toBe('response_filtering');
  });
});

describe('proxy extractMessages', () => {
  it('reads text from content-block arrays and the Anthropic system prompt', () => {
    const msgs = extractMessages({
      system: [{ type: 'text', text: 'You are helpful' }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'secret project X' }, { type: 'image', source: {} }] },
        { role: 'user', content: [{ type: 'tool_result', content: [{ type: 'text', text: 'AKIA1234' }] }] },
      ],
    });
    expect(msgs).toEqual([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'secret project X' },
      { role: 'user', content: 'AKIA1234' },
    ]);
    expect(JSON.stringify(msgs)).not.toContain('[object Object]');
  });

  it('reads embeddings-style input', () => {
    expect(extractMessages({ input: ['a', 'b'] })).toEqual([{ role: 'user', content: 'a\nb' }]);
  });
});
