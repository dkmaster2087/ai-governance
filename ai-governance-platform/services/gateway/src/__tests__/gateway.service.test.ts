import { GatewayService } from '../services/gateway.service';
import { PolicyEngineClient } from '../clients/policy-engine.client';
import { DataProtectionClient } from '../clients/data-protection.client';
import { ProviderRouter } from '../services/provider.router';
import { AuditService } from '../services/audit.service';
import { collection, MemoryStore, setRecords } from '@ai-governance/storage';

jest.mock('../clients/policy-engine.client');
jest.mock('../clients/data-protection.client');
jest.mock('../services/provider.router');
jest.mock('../services/audit.service');

const mockPolicyClient = PolicyEngineClient as jest.MockedClass<typeof PolicyEngineClient>;
const mockDataProtection = DataProtectionClient as jest.MockedClass<typeof DataProtectionClient>;
const mockProviderRouter = ProviderRouter as jest.MockedClass<typeof ProviderRouter>;
const mockAuditService = AuditService as jest.MockedClass<typeof AuditService>;

describe('GatewayService', () => {
  let service: GatewayService;

  const mockRequest = {
    tenantId: 'tenant_123',
    userId: 'user_456',
    appId: 'app_789',
    model: 'anthropic.claude-3-haiku-20240307-v1:0',
    messages: [{ role: 'user' as const, content: 'Hello' }],
  };

  const mockNormalizedResponse = {
    requestId: 'req_123',
    provider: 'bedrock' as const,
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    content: 'Hello! How can I help?',
    inputTokens: 10,
    outputTokens: 20,
    latencyMs: 500,
    finishReason: 'stop',
    timestamp: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    setRecords(new MemoryStore());

    mockDataProtection.prototype.protectRequest.mockResolvedValue({
      requestId: 'req_123',
      tenantId: 'tenant_123',
      userId: 'user_456',
      appId: 'app_789',
      provider: 'bedrock',
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      messages: [{ role: 'user', content: 'Hello' }],
      metadata: {},
      timestamp: new Date().toISOString(),
    });

    mockDataProtection.prototype.filterResponse.mockResolvedValue(mockNormalizedResponse);
    mockProviderRouter.prototype.resolveProvider.mockReturnValue('bedrock');
    mockProviderRouter.prototype.route.mockResolvedValue(mockNormalizedResponse);
    mockAuditService.prototype.log.mockResolvedValue(undefined);

    service = new GatewayService();
  });

  it('allows request when policy engine approves', async () => {
    mockPolicyClient.prototype.evaluate.mockResolvedValue({
      allowed: true,
      action: 'allow',
      triggeredRules: [],
      riskScore: 0,
    });

    const result = await service.processRequest(mockRequest);
    expect(result.content).toBe('Hello! How can I help?');
    expect(mockProviderRouter.prototype.route).toHaveBeenCalledTimes(1);
  });

  it('blocks request when policy engine denies', async () => {
    mockPolicyClient.prototype.evaluate.mockResolvedValue({
      allowed: false,
      action: 'block',
      triggeredRules: ['keyword_block_rule'],
      riskScore: 100,
      reason: 'Blocked keyword detected',
    });

    await expect(service.processRequest(mockRequest)).rejects.toMatchObject({
      code: 'POLICY_VIOLATION',
    });
    expect(mockProviderRouter.prototype.route).not.toHaveBeenCalled();
  });

  it('logs audit entry for every request', async () => {
    mockPolicyClient.prototype.evaluate.mockResolvedValue({
      allowed: true,
      action: 'allow',
      triggeredRules: [],
      riskScore: 0,
    });

    await service.processRequest(mockRequest);
    expect(mockAuditService.prototype.log).toHaveBeenCalledTimes(1);
  });

  it('records a case file when the provider refuses, then passes the error on', async () => {
    mockPolicyClient.prototype.evaluate.mockResolvedValue({ allowed: true, action: 'allow', triggeredRules: [], riskScore: 0 });
    mockProviderRouter.prototype.route.mockRejectedValue(new Error('Provider bedrock: model is not available for this account'));

    await expect(service.processRequest(mockRequest)).rejects.toThrow('not available');
    expect(mockAuditService.prototype.log).toHaveBeenCalledTimes(1);
    const [request, response] = mockAuditService.prototype.log.mock.calls[0];
    expect(request.metadata?.providerError).toBe('Provider bedrock: model is not available for this account');
    expect(response).toMatchObject({ content: '', outputTokens: 0, finishReason: 'error' });
  });

  describe('each model\'s settings', () => {
    const allow = { allowed: true, action: 'allow' as const, triggeredRules: [], riskScore: 0 };
    const addModel = (extra: object) => collection('models').put({
      tenantId: 'tenant_123', modelConfigId: 'm1', name: 'Claude Haiku', provider: 'bedrock', modelId: mockRequest.model,
      status: 'active', isDefault: false, maxTokensPerRequest: 500, inputCostPer1kTokens: 0, outputCostPer1kTokens: 0, tags: [], ...extra,
    } as any);
    beforeEach(() => mockPolicyClient.prototype.evaluate.mockResolvedValue(allow));

    it('caps the answer at the model\'s limit, and records when it did', async () => {
      await addModel({});
      await service.processRequest({ ...mockRequest, maxTokens: 4000 });
      const sent = (mockProviderRouter.prototype.route.mock.calls[0] as any[])[0];
      expect(sent.maxTokens).toBe(500);
      expect((mockAuditService.prototype.log.mock.calls[0] as any[])[0].metadata).toMatchObject({ maxTokensCapped: '4000→500' });

      await service.processRequest(mockRequest); // asked for nothing: gets the limit
      expect((mockProviderRouter.prototype.route.mock.calls[1] as any[])[0].maxTokens).toBe(500);
      await service.processRequest({ ...mockRequest, maxTokens: 100 }); // smaller requests are left alone
      expect((mockProviderRouter.prototype.route.mock.calls[2] as any[])[0].maxTokens).toBe(100);
    });

    it('lets only the chosen keys use a model, and records the refusal', async () => {
      await addModel({ allowedKeyIds: ['key_support'] });
      expect((await service.processRequest({ ...mockRequest, keyId: 'key_support' })).content).toBe('Hello! How can I help?');

      await expect(service.processRequest({ ...mockRequest, keyId: 'key_marketing' })).rejects.toMatchObject({ code: 'MODEL_NOT_ALLOWED', statusCode: 403 });
      await expect(service.processRequest(mockRequest)).rejects.toMatchObject({ code: 'MODEL_NOT_ALLOWED' });
      expect(mockProviderRouter.prototype.route).toHaveBeenCalledTimes(1);
      expect(mockPolicyClient.prototype.evaluate).toHaveBeenCalledTimes(1); // refused before anything else ran
      const [req, , result] = mockAuditService.prototype.log.mock.calls.at(-1) as any[];
      expect(req.metadata).toMatchObject({ check: 'model_keys' });
      expect(result).toMatchObject({ allowed: false, reason: expect.stringContaining('may not use Claude Haiku') });
    });

    it('leaves models nobody configured alone', async () => {
      await service.processRequest({ ...mockRequest, maxTokens: 9000, keyId: 'any' });
      expect((mockProviderRouter.prototype.route.mock.calls[0] as any[])[0].maxTokens).toBe(9000);
    });
  });
});
