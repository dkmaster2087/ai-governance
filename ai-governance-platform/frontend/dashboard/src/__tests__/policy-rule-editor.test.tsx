import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { ThemeProvider } from '../lib/theme';
import { PolicyRuleEditor, PolicyRule } from '../components/policies/PolicyRuleEditor';

// Mock the API to return test models
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return {
    ...actual,
    fetchModelConfigs: vi.fn().mockResolvedValue([
      { modelConfigId: 'm1', name: 'Claude Haiku', modelId: 'anthropic.claude-3-haiku-20240307-v1:0', provider: 'bedrock', status: 'active', isDefault: true, region: 'us-east-1', maxTokensPerRequest: 4096, maxContextTokens: 200000, inputCostPer1kTokens: 0.00025, outputCostPer1kTokens: 0.00125, allowedForRoles: [], allowedForApps: [], requiresApproval: false, tags: [], createdAt: '', updatedAt: '', createdBy: 'admin' },
      { modelConfigId: 'm2', name: 'GPT-4o', modelId: 'gpt-4o', provider: 'openai', status: 'active', isDefault: false, region: '', maxTokensPerRequest: 4096, maxContextTokens: 128000, inputCostPer1kTokens: 0.005, outputCostPer1kTokens: 0.015, allowedForRoles: [], allowedForApps: [], requiresApproval: false, tags: [], createdAt: '', updatedAt: '', createdBy: 'admin' },
      { modelConfigId: 'm3', name: 'Old Model', modelId: 'old-model-v1', provider: 'custom', status: 'inactive', isDefault: false, region: '', maxTokensPerRequest: 2048, maxContextTokens: 4096, inputCostPer1kTokens: 0, outputCostPer1kTokens: 0, allowedForRoles: [], allowedForApps: [], requiresApproval: false, tags: [], createdAt: '', updatedAt: '', createdBy: 'admin' },
    ]),
  };
});

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

describe('PolicyRuleEditor', () => {
  it('renders empty state when no rules', () => {
    wrap(<PolicyRuleEditor rules={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/No rules yet/)).toBeInTheDocument();
  });

  it('renders Add rule button', () => {
    wrap(<PolicyRuleEditor rules={[]} onChange={vi.fn()} />);
    expect(screen.getByText('Add rule')).toBeInTheDocument();
  });

  it('calls onChange when Add rule clicked', () => {
    const onChange = vi.fn();
    wrap(<PolicyRuleEditor rules={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText('Add rule'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
  });

  it('renders rule with type and action selectors', () => {
    const rules: PolicyRule[] = [{
      ruleId: 'r1', type: 'keyword_block', action: 'block',
      priority: 1, enabled: true, description: 'Test rule', config: { keywords: ['secret'] },
    }];
    wrap(<PolicyRuleEditor rules={rules} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Keyword Block')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Block')).toBeInTheDocument();
  });
});

describe('Model Restriction — configured models checklist', () => {
  const modelRule: PolicyRule = {
    ruleId: 'r1', type: 'model_restriction', action: 'block',
    priority: 1, enabled: true, description: 'Only approved models',
    config: { allowedModels: [] },
  };

  it('shows configured models as checkboxes', async () => {
    wrap(<PolicyRuleEditor rules={[modelRule]} onChange={vi.fn()} />);
    // Wait for models to load
    expect(await screen.findByText('Claude Haiku')).toBeInTheDocument();
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
    expect(screen.getByText('Old Model')).toBeInTheDocument();
  });

  it('shows model status badges', async () => {
    wrap(<PolicyRuleEditor rules={[modelRule]} onChange={vi.fn()} />);
    await screen.findByText('Claude Haiku');
    const activeBadges = screen.getAllByText('active');
    expect(activeBadges.length).toBe(2); // Claude Haiku + GPT-4o
    expect(screen.getByText('inactive')).toBeInTheDocument();
  });

  it('shows model IDs', async () => {
    wrap(<PolicyRuleEditor rules={[modelRule]} onChange={vi.fn()} />);
    await screen.findByText('Claude Haiku');
    expect(screen.getByText('anthropic.claude-3-haiku-20240307-v1:0')).toBeInTheDocument();
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
  });

  it('shows warning when no models selected', async () => {
    wrap(<PolicyRuleEditor rules={[modelRule]} onChange={vi.fn()} />);
    await screen.findByText('Claude Haiku');
    expect(screen.getByText(/all requests will be blocked/)).toBeInTheDocument();
  });

  it('shows count when models are selected', async () => {
    const ruleWithModels = { ...modelRule, config: { allowedModels: ['gpt-4o'] } };
    wrap(<PolicyRuleEditor rules={[ruleWithModels]} onChange={vi.fn()} />);
    await screen.findByText('Claude Haiku');
    expect(screen.getByText(/1 model allowed/)).toBeInTheDocument();
  });

  it('has Select all active button', async () => {
    wrap(<PolicyRuleEditor rules={[modelRule]} onChange={vi.fn()} />);
    await screen.findByText('Claude Haiku');
    expect(screen.getByText('Select all active')).toBeInTheDocument();
  });

  it('calls onChange when a model is toggled', async () => {
    const onChange = vi.fn();
    wrap(<PolicyRuleEditor rules={[modelRule]} onChange={onChange} />);
    await screen.findByText('Claude Haiku');
    // Click the checkbox for Claude Haiku
    const checkboxes = screen.getAllByRole('checkbox');
    // First checkbox is the toggle, find the model checkboxes
    const modelCheckbox = checkboxes.find((cb) => cb.closest('label')?.textContent?.includes('Claude Haiku'));
    if (modelCheckbox) fireEvent.click(modelCheckbox);
    expect(onChange).toHaveBeenCalled();
  });

  it('inactive models appear dimmed', async () => {
    wrap(<PolicyRuleEditor rules={[modelRule]} onChange={vi.fn()} />);
    await screen.findByText('Old Model');
    const label = screen.getByText('Old Model').closest('label');
    expect(label?.className).toContain('opacity-60');
  });
});
