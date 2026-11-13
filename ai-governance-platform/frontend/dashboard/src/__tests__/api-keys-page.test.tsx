import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

const createKey = vi.fn(async (..._args: unknown[]) => ({ keyId: 'k2', key: 'pbl_demo_secretvalue' }));
const setKeyLimits = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock('../lib/api-keys-api', () => ({
  listKeys: vi.fn(async () => [
    { keyId: 'k1', keyPrefix: 'pbl_demo_ab...', name: 'support-bot', scopes: ['chat', 'models'], status: 'active', createdAt: '2026-10-01', lastUsedAt: '2026-10-03', createdBy: 'u', dailyTokenLimit: 100000, dailySpendLimitUsd: 25 },
    { keyId: 'k3', keyPrefix: 'pbl_demo_ef...', name: 'hr-assistant', scopes: ['mcp'], status: 'active', createdAt: '2026-10-05', lastUsedAt: '2026-10-02', createdBy: 'u' },
    { keyId: 'k4', keyPrefix: 'pbl_demo_gh...', name: 'chrome-fleet', scopes: ['shadow_ai:ingest'], status: 'active', createdAt: '2026-10-04', createdBy: 'u' },
    { keyId: 'k5', keyPrefix: 'pbl_demo_ij...', name: 'ops-agent', scopes: ['chat', 'mcp'], status: 'active', createdAt: '2026-10-02', createdBy: 'u' },
    { keyId: 'k0', keyPrefix: 'pbl_demo_cd...', name: 'old-app', scopes: ['chat'], status: 'revoked', createdAt: '2026-09-01', createdBy: 'u' },
  ]),
  createKey: (...a: unknown[]) => createKey(...a),
  revokeKey: vi.fn(), rotateKey: vi.fn(), deleteKey: vi.fn(),
  setKeyLimits: (...a: unknown[]) => setKeyLimits(...a),
}));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { tenantId: 't' } }) }));
import { ApiKeysPage } from '../pages/ApiKeysPage';

const renderPage = (path = '/keys') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><ApiKeysPage /></MemoryRouter></QueryClientProvider>
);
const names = () => screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'));

describe('API keys page', () => {
  it('marks each key with what it is for, and lists active keys newest first', async () => {
    renderPage();
    const bot = await screen.findByRole('article', { name: 'support-bot' });
    expect(within(bot).getByText('Apps & IDEs')).toBeInTheDocument();
    expect(within(bot).getByText('Can: Send AI requests · List models')).toBeInTheDocument();
    const ops = screen.getByRole('article', { name: 'ops-agent' });
    expect(within(ops).getByText('Apps & IDEs')).toBeInTheDocument();
    expect(within(ops).getByText('AI agents (MCP)')).toBeInTheDocument();
    expect(names()).toEqual(['hr-assistant', 'chrome-fleet', 'ops-agent', 'support-bot']);
  });

  it('filters by category with counts, by status, and by search, and can clear them', async () => {
    renderPage();
    const cards = await screen.findByRole('group', { name: 'Keys by what they\'re for' });
    const agents = within(cards).getByRole('button', { name: /AI agents \(MCP\)/ });
    expect(agents).toHaveTextContent('2');
    fireEvent.click(agents);
    expect(names()).toEqual(['hr-assistant', 'ops-agent']);
    expect(screen.getByText(/Showing 2 of 5 keys/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoked or expired (1)' }));
    expect(names()).toEqual(['old-app']);

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByLabelText('Search keys'), { target: { value: 'FLEET' } });
    expect(names()).toEqual(['chrome-fleet']);
    fireEvent.change(screen.getByLabelText('Search keys'), { target: { value: 'nothing-like-this' } });
    expect(screen.getByText('No keys match.')).toBeInTheDocument();
  });

  it('reads filters from the address and sorts by last use', async () => {
    renderPage('/keys?category=apps&sort=used');
    await screen.findByRole('article', { name: 'support-bot' });
    expect(names()).toEqual(['support-bot', 'ops-agent']);
  });

  it('creates a key, grouping permissions by what they are for, and shows it once', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Create a key' }));
    const form = screen.getByRole('region', { name: 'New API key' });
    expect(within(form).getByText('AI agents (MCP)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'billing-api' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByText('pbl_demo_secretvalue')).toBeInTheDocument();
    await waitFor(() => expect(createKey.mock.calls[0][0]).toEqual({ name: 'billing-api', scopes: ['chat', 'models'] }));
  });

  it('shows each key\'s daily limit and lets an admin change it', async () => {
    renderPage();
    const bot = await screen.findByRole('article', { name: 'support-bot' });
    expect(within(bot).getByText('100,000 tokens · $25')).toBeInTheDocument();
    expect(within(await screen.findByRole('article', { name: 'hr-assistant' })).getByText('None')).toBeInTheDocument();
    fireEvent.click(within(bot).getByRole('button', { name: 'Daily limit' }));
    const form = within(bot).getByRole('form', { name: 'support-bot daily limit' });
    fireEvent.change(within(form).getByLabelText('Tokens a day'), { target: { value: '' } });
    fireEvent.change(within(form).getByLabelText('Spend a day (USD)'), { target: { value: '10' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setKeyLimits).toHaveBeenCalledWith('k1', { dailyTokenLimit: 0, dailySpendLimitUsd: 10 }));
  });
});
