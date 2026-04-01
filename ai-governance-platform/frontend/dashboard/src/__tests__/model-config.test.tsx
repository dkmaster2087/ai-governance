import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { ThemeProvider } from '../lib/theme';
import { ModelConfigModal } from '../components/models/ModelConfigModal';

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ThemeProvider>{ui}</ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const baseProps = { onClose: vi.fn(), onSaved: vi.fn() };

describe('ModelConfigModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders Add Model title when no model provided', () => {
    wrap(<ModelConfigModal model={null} {...baseProps} />);
    expect(screen.getByText('Add Model Configuration')).toBeInTheDocument();
  });

  it('renders Edit Model title when editing', () => {
    wrap(<ModelConfigModal model={{ modelConfigId: 'm1', name: 'Test', modelId: 'gpt-4o', provider: 'openai' }} {...baseProps} />);
    expect(screen.getByText('Edit Model')).toBeInTheDocument();
  });

  it('shows provider selector with all options', () => {
    wrap(<ModelConfigModal model={null} {...baseProps} />);
    expect(screen.getByText('Amazon Bedrock')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
  });

  it('save button is disabled when name is empty', () => {
    wrap(<ModelConfigModal model={null} {...baseProps} />);
    expect(screen.getByText('Add Model')).toBeDisabled();
  });

  it('shows three tabs', () => {
    wrap(<ModelConfigModal model={null} {...baseProps} />);
    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByText('Limits & Cost')).toBeInTheDocument();
    expect(screen.getByText('Governance')).toBeInTheDocument();
  });

  it('calls onClose when Cancel clicked', () => {
    wrap(<ModelConfigModal model={null} {...baseProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  // ── Limits & validation ─────────────────────────────────────────────

  it('shows model limits info when a known model is selected', () => {
    wrap(<ModelConfigModal model={{ modelConfigId: 'm1', name: 'Test', modelId: 'gpt-4o', provider: 'openai' }} {...baseProps} />);
    fireEvent.click(screen.getByText('Limits & Cost'));
    expect(screen.getByText(/16,384/)).toBeInTheDocument(); // maxOutput
    expect(screen.getByText(/128,000/)).toBeInTheDocument(); // contextWindow
  });

  it('shows validation error when max tokens exceeds model limit', () => {
    wrap(<ModelConfigModal model={{ modelConfigId: 'm1', name: 'Test', modelId: 'gpt-4o', provider: 'openai', maxTokensPerRequest: 99999 }} {...baseProps} />);
    fireEvent.click(screen.getByText('Limits & Cost'));
    expect(screen.getByText(/Exceeds model limit of 16,384 tokens/)).toBeInTheDocument();
  });

  it('shows validation error when context window exceeds model limit', () => {
    wrap(<ModelConfigModal model={{ modelConfigId: 'm1', name: 'Test', modelId: 'gpt-4o', provider: 'openai', maxContextTokens: 999999 }} {...baseProps} />);
    fireEvent.click(screen.getByText('Limits & Cost'));
    expect(screen.getByText(/Exceeds model limit of 128,000 tokens/)).toBeInTheDocument();
  });

  it('disables save button when validation errors exist', () => {
    wrap(<ModelConfigModal model={{ modelConfigId: 'm1', name: 'Test', modelId: 'gpt-4o', provider: 'openai', maxTokensPerRequest: 99999 }} {...baseProps} />);
    expect(screen.getByText('Save Changes')).toBeDisabled();
  });

  it('does not show validation error for values within limits', () => {
    wrap(<ModelConfigModal model={{ modelConfigId: 'm1', name: 'Test', modelId: 'gpt-4o', provider: 'openai', maxTokensPerRequest: 4096, maxContextTokens: 8192 }} {...baseProps} />);
    fireEvent.click(screen.getByText('Limits & Cost'));
    expect(screen.queryByText(/Exceeds model limit/)).not.toBeInTheDocument();
  });

  it('does not show limits info for unknown/custom models', () => {
    wrap(<ModelConfigModal model={{ modelConfigId: 'm1', name: 'Test', modelId: 'my-custom-model', provider: 'custom' }} {...baseProps} />);
    fireEvent.click(screen.getByText('Limits & Cost'));
    expect(screen.queryByText(/output tokens/)).not.toBeInTheDocument();
  });

  // ── Info tooltips ───────────────────────────────────────────────────

  it('shows info tooltips on limits tab', () => {
    wrap(<ModelConfigModal model={{ modelConfigId: 'm1', name: 'Test', modelId: 'gpt-4o', provider: 'openai' }} {...baseProps} />);
    fireEvent.click(screen.getByText('Limits & Cost'));
    expect(screen.getByText(/maximum number of tokens the model can generate/)).toBeInTheDocument();
    expect(screen.getByText(/total number of tokens the model can process/)).toBeInTheDocument();
  });

  // ── Governance tab ──────────────────────────────────────────────────

  it('shows governance fields', () => {
    wrap(<ModelConfigModal model={null} {...baseProps} />);
    fireEvent.click(screen.getByText('Governance'));
    expect(screen.getByText(/Require approval/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Allowed roles/)).toBeInTheDocument();
  });

  // ── Edit with onError fallback ──────────────────────────────────────

  it('shows Save Changes button when editing', () => {
    wrap(<ModelConfigModal model={{ modelConfigId: 'm1', name: 'Test', modelId: 'gpt-4o', provider: 'openai' }} {...baseProps} />);
    expect(screen.getByText('Save Changes')).toBeInTheDocument();
  });

  it('shows red dot on Limits tab when validation error exists', () => {
    wrap(<ModelConfigModal model={{ modelConfigId: 'm1', name: 'Test', modelId: 'gpt-4o', provider: 'openai', maxTokensPerRequest: 99999 }} {...baseProps} />);
    // The Limits tab should have a red indicator dot
    const limitsTab = screen.getByText('Limits & Cost');
    const dot = limitsTab.parentElement?.querySelector('.bg-red-400');
    expect(dot).toBeTruthy();
  });
});
