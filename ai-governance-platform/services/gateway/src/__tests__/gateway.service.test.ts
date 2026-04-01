import { GatewayService } from '../services/gateway.service';
import { PolicyEngineClient } from '../clients/policy-engine.client';
import { DataProtectionClient } from '../clients/data-protection.client';
import { ProviderRouter } from '../services/provider.router';
import { AuditService } from '../services/audit.service';

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
});
