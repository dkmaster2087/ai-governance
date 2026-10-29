import { ProviderRouter } from '../services/provider.router';
import { BedrockProvider } from '../providers/bedrock.provider';
import { OpenAIProvider } from '../providers/openai.provider';
import { ModelConfigRepository } from '../repositories/model-config.repository';
import { ModelConfigService } from '../services/model-config.service';

jest.mock('../providers/bedrock.provider');
jest.mock('../providers/openai.provider');
jest.mock('../repositories/model-config.repository');
jest.mock('../services/model-config.service');

const request = (modelId: string) => ({
  requestId: 'r1', tenantId: 't1', userId: 'u1', appId: 'a1',
  provider: new ProviderRouter().resolveProvider(modelId), modelId,
  messages: [{ role: 'user' as const, content: 'hi' }], metadata: {}, timestamp: new Date().toISOString(),
});

describe('ProviderRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ModelConfigService.prototype.resolveProviderKey as jest.Mock).mockResolvedValue('sk-test');
    (OpenAIProvider.prototype.complete as jest.Mock).mockResolvedValue({ via: 'openai' });
    (BedrockProvider.prototype.complete as jest.Mock).mockResolvedValue({ via: 'bedrock' });
  });

  it('uses the provider the admin configured, not a guess from the model name', async () => {
    // "o3-mini" doesn't match any name prefix, so the guess would be Bedrock.
    (ModelConfigRepository.prototype.getForTenant as jest.Mock).mockResolvedValue([{ modelId: 'o3-mini', provider: 'openai' }]);
    const result = await new ProviderRouter().route(request('o3-mini') as any);
    expect(result).toEqual({ via: 'openai' });
    expect(OpenAIProvider.prototype.complete).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai' }), 'sk-test');
  });

  it('falls back to the name-based guess for models nobody configured', async () => {
    (ModelConfigRepository.prototype.getForTenant as jest.Mock).mockResolvedValue([]);
    await new ProviderRouter().route(request('anthropic.claude-3-haiku') as any);
    expect(BedrockProvider.prototype.complete).toHaveBeenCalled();
  });

  it('refuses providers the gateway cannot call', async () => {
    (ModelConfigRepository.prototype.getForTenant as jest.Mock).mockResolvedValue([{ modelId: 'x', provider: 'google-vertex' }]);
    await expect(new ProviderRouter().route(request('x') as any)).rejects.toThrow(/not configured/);
  });
});
