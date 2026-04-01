import { ModelConfigService } from '../services/model-config.service';
import { ModelConfigRepository } from '../repositories/model-config.repository';

jest.mock('../repositories/model-config.repository');
jest.mock('../providers/bedrock.provider');
jest.mock('../providers/openai.provider');

const MockRepo = ModelConfigRepository as jest.MockedClass<typeof ModelConfigRepository>;

const mockModel = {
  modelConfigId: 'model_1',
  tenantId: 'tenant_demo',
  name: 'Test Model',
  provider: 'bedrock' as const,
  modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
  status: 'active' as const,
  isDefault: false,
  region: 'us-east-1',
  maxTokensPerRequest: 4096,
  maxContextTokens: 200000,
  inputCostPer1kTokens: 0.00025,
  outputCostPer1kTokens: 0.00125,
  allowedForRoles: [],
  allowedForApps: [],
  requiresApproval: false,
  tags: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  createdBy: 'admin',
  apiKeySecretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:test',
};

describe('ModelConfigService', () => {
  let service: ModelConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ModelConfigService();
  });

  it('strips apiKeySecretArn from returned configs', async () => {
    MockRepo.prototype.getForTenant.mockResolvedValue([mockModel]);
    const result = await service.getModelsForTenant('tenant_demo');
    expect(result[0]).not.toHaveProperty('apiKeySecretArn');
  });

  it('returns model configs for tenant', async () => {
    MockRepo.prototype.getForTenant.mockResolvedValue([mockModel]);
    const result = await service.getModelsForTenant('tenant_demo');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Test Model');
  });

  it('creates model config', async () => {
    MockRepo.prototype.getForTenant.mockResolvedValue([]);
    MockRepo.prototype.create.mockResolvedValue(mockModel);
    const { modelConfigId, createdAt, updatedAt, ...data } = mockModel;
    const result = await service.createModel('tenant_demo', data, 'admin');
    expect(MockRepo.prototype.create).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('apiKeySecretArn');
  });

  it('clears existing default when new default is set', async () => {
    const existingDefault = { ...mockModel, modelConfigId: 'model_old', isDefault: true };
    MockRepo.prototype.getForTenant.mockResolvedValue([existingDefault]);
    MockRepo.prototype.update.mockResolvedValue({ ...existingDefault, isDefault: false });
    MockRepo.prototype.create.mockResolvedValue({ ...mockModel, isDefault: true });

    const { modelConfigId, createdAt, updatedAt, ...data } = mockModel;
    await service.createModel('tenant_demo', { ...data, isDefault: true }, 'admin');

    expect(MockRepo.prototype.update).toHaveBeenCalledWith(
      'tenant_demo', 'model_old', expect.objectContaining({ isDefault: false })
    );
  });

  it('returns failed test result when model not found', async () => {
    MockRepo.prototype.getById.mockResolvedValue(null);
    const result = await service.testModel('tenant_demo', 'nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});
