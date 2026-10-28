import { ProviderKeyStore, SecretBackend } from '../services/provider-key.store';
import { ModelConfigService } from '../services/model-config.service';
import { ModelConfigRepository } from '../repositories/model-config.repository';

jest.mock('../repositories/model-config.repository');
const MockRepo = ModelConfigRepository as jest.MockedClass<typeof ModelConfigRepository>;

function fakeBackend() {
  const secrets = new Map<string, string>();
  const backend: SecretBackend & { secrets: Map<string, string>; gets: number } = {
    secrets,
    gets: 0,
    async put(name, value) { secrets.set(`arn:${name}`, value); return `arn:${name}`; },
    async get(arn) { backend.gets++; const v = secrets.get(arn); if (!v) throw new Error('missing'); return v; },
    async delete(arn) { secrets.delete(arn); },
  };
  return backend;
}

const baseModel = {
  modelConfigId: 'm1', tenantId: 'tenant_acme', name: 'GPT', provider: 'openai' as const, modelId: 'gpt-4o',
  status: 'active' as const, isDefault: false, maxTokensPerRequest: 1000, inputCostPer1kTokens: 0,
  outputCostPer1kTokens: 0, maxContextTokens: 8000, allowedForRoles: [], allowedForApps: [],
  requiresApproval: false, tags: [], createdAt: '', updatedAt: '', createdBy: 'u',
};

describe('ProviderKeyStore', () => {
  it('stores keys per tenant and model, and caches reads', async () => {
    const backend = fakeBackend();
    const store = new ProviderKeyStore(backend, 60_000, 'aegis/test/provider-keys');
    const arn = await store.save('tenant_acme', 'm1', 'sk-secret');
    expect(arn).toBe('arn:aegis/test/provider-keys/tenant_acme/m1');

    const fresh = new ProviderKeyStore(backend, 60_000, 'aegis/test/provider-keys');
    expect(await fresh.resolve({ apiKeySecretArn: arn })).toBe('sk-secret');
    expect(await fresh.resolve({ apiKeySecretArn: arn })).toBe('sk-secret');
    expect(backend.gets).toBe(1);
  });

  it('returns undefined when no key is configured', async () => {
    const store = new ProviderKeyStore(fakeBackend());
    expect(await store.resolve({})).toBeUndefined();
  });
});

describe('ModelConfigService provider keys', () => {
  beforeEach(() => jest.clearAllMocks());

  it('never writes the raw key to the model table', async () => {
    const backend = fakeBackend();
    MockRepo.prototype.create.mockImplementation(async (data) => ({ ...data, modelConfigId: 'm1', createdAt: '', updatedAt: '' }) as any);
    const service = new ModelConfigService(new ModelConfigRepository(), new ProviderKeyStore(backend, 60_000, 'p'));

    const { modelConfigId, createdAt, updatedAt, tenantId, ...data } = baseModel;
    const result = await service.createModel('tenant_acme', data, 'u', 'sk-live-1234');

    const written = JSON.stringify(MockRepo.prototype.create.mock.calls[0][0]);
    expect(written).not.toContain('sk-live-1234');
    expect(MockRepo.prototype.setApiKeySecret).toHaveBeenCalledWith('tenant_acme', 'm1', 'arn:p/tenant_acme/m1', '...1234');
    expect(backend.secrets.get('arn:p/tenant_acme/m1')).toBe('sk-live-1234');
    expect(result).not.toHaveProperty('apiKeySecretArn');
    expect(JSON.stringify(result)).not.toContain('sk-live-1234');
  });

  it('ignores secret ARNs supplied by clients on update', async () => {
    MockRepo.prototype.update.mockImplementation(async (_t, _id, data) => data as any);
    const service = new ModelConfigService(new ModelConfigRepository(), new ProviderKeyStore(fakeBackend()));
    await service.updateModel('tenant_acme', 'm1', { name: 'x', apiKeySecretArn: 'arn:other-tenant-secret' });
    expect(MockRepo.prototype.update.mock.calls[0][2]).not.toHaveProperty('apiKeySecretArn');
  });

  it('moves a legacy plaintext key into Secrets Manager on first use', async () => {
    const backend = fakeBackend();
    const service = new ModelConfigService(new ModelConfigRepository(), new ProviderKeyStore(backend, 60_000, 'p'));
    const legacy = { ...baseModel, apiKeyStored: 'sk-legacy' } as any;

    expect(await service.resolveProviderKey(legacy)).toBe('sk-legacy');
    expect(backend.secrets.get('arn:p/tenant_acme/m1')).toBe('sk-legacy');
    expect(MockRepo.prototype.setApiKeySecret).toHaveBeenCalledWith('tenant_acme', 'm1', 'arn:p/tenant_acme/m1');
  });

  it('deletes the secret when the model config is deleted', async () => {
    const backend = fakeBackend();
    const store = new ProviderKeyStore(backend, 60_000, 'p');
    const arn = await store.save('tenant_acme', 'm1', 'sk-x');
    MockRepo.prototype.getById.mockResolvedValue({ ...baseModel, apiKeySecretArn: arn });
    const service = new ModelConfigService(new ModelConfigRepository(), store);
    await service.deleteModel('tenant_acme', 'm1');
    expect(backend.secrets.has(arn)).toBe(false);
  });
});
