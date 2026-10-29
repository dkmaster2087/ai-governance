import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { ModelForm, ModelsPage } from '../pages/ModelsPage';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  fetchModelConfigs: vi.fn(),
  createModelConfig: vi.fn(),
  updateModelConfig: vi.fn(),
  deleteModelConfig: vi.fn(),
  testModelConfig: vi.fn(),
}));

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
};

const openaiModel = {
  modelConfigId: 'm1', name: 'GPT for support', provider: 'openai', modelId: 'gpt-4o', status: 'active' as const,
  apiKeyHint: '...abcd', inputCostPer1kTokens: 0.005, outputCostPer1kTokens: 0.015,
};

describe('ModelForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers only the providers the gateway can call', () => {
    wrap(<ModelForm onDone={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Provider' });
    expect(group.querySelectorAll('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Amazon Bedrock' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OpenAI' })).toBeInTheDocument();
  });

  it('asks for a key only for OpenAI', () => {
    wrap(<ModelForm onDone={vi.fn()} />);
    expect(screen.queryByText('OpenAI key')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }));
    expect(screen.getByText('OpenAI key')).toBeInTheDocument();
  });

  it('cannot save without a name and model ID', () => {
    wrap(<ModelForm onDone={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add model' })).toBeDisabled();
  });

  it('keeps the existing key when editing and the key is left blank', async () => {
    vi.mocked(api.updateModelConfig).mockResolvedValue({});
    const onDone = vi.fn();
    wrap(<ModelForm model={openaiModel} onDone={onDone} />);
    expect(screen.getByPlaceholderText(/keeps key ending abcd/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [id, payload] = vi.mocked(api.updateModelConfig).mock.calls[0];
    expect(id).toBe('m1');
    expect(payload).toMatchObject({ provider: 'openai', modelId: 'gpt-4o', apiKey: undefined });
  });

  it('shows the server’s reason when saving fails', async () => {
    vi.mocked(api.createModelConfig).mockRejectedValue({ response: { data: { message: 'Invalid model' } } });
    wrap(<ModelForm onDone={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. Claude for support'), { target: { value: 'X' } });
    fireEvent.change(screen.getByPlaceholderText(/anthropic\.claude/), { target: { value: 'amazon.titan-text-express-v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid model');
  });
});

describe('ModelsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('leads with how many models are listed for apps', async () => {
    vi.mocked(api.fetchModelConfigs).mockResolvedValue([openaiModel, { ...openaiModel, modelConfigId: 'm2', name: 'Old', status: 'inactive' }]);
    wrap(<ModelsPage />);
    expect(await screen.findByText('1 model listed for apps.')).toBeInTheDocument();
    expect(screen.getByText('Not listed')).toBeInTheDocument();
  });

  it('marks models set up for a provider the gateway can’t call', async () => {
    vi.mocked(api.fetchModelConfigs).mockResolvedValue([{ ...openaiModel, provider: 'google-vertex' }]);
    wrap(<ModelsPage />);
    expect(await screen.findByText('google-vertex (not supported)')).toBeInTheDocument();
  });

  it('shows the test result', async () => {
    vi.mocked(api.fetchModelConfigs).mockResolvedValue([openaiModel]);
    vi.mocked(api.testModelConfig).mockResolvedValue({ success: true, latencyMs: 412 });
    wrap(<ModelsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test' }));
    expect(await screen.findByText('Answered in 412 ms')).toBeInTheDocument();
  });

  it('asks before removing', async () => {
    vi.mocked(api.fetchModelConfigs).mockResolvedValue([openaiModel]);
    vi.mocked(api.deleteModelConfig).mockResolvedValue(undefined);
    wrap(<ModelsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Remove GPT for support?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.deleteModelConfig).toHaveBeenCalledWith('m1'));
  });
});
