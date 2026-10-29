import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

const createKey = vi.fn(async (..._args: unknown[]) => ({ keyId: 'k2', key: 'aegis_demo_secretvalue' }));
vi.mock('../lib/api-keys-api', () => ({
  listKeys: vi.fn(async () => [
    { keyId: 'k1', keyPrefix: 'aegis_demo_ab...', name: 'support-bot', scopes: ['chat', 'models'], status: 'active', createdAt: '2026-10-01', createdBy: 'u' },
    { keyId: 'k0', keyPrefix: 'aegis_demo_cd...', name: 'old-app', scopes: ['chat'], status: 'revoked', createdAt: '2026-09-01', createdBy: 'u' },
  ]),
  createKey: (...a: unknown[]) => createKey(...a),
  revokeKey: vi.fn(), rotateKey: vi.fn(), deleteKey: vi.fn(),
}));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { tenantId: 't' } }) }));
import { ApiKeysPage } from '../pages/ApiKeysPage';

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ApiKeysPage /></MemoryRouter></QueryClientProvider>
);

describe('API keys page', () => {
  it('lists keys with what they can do', async () => {
    renderPage();
    expect(await screen.findByText('support-bot')).toBeInTheDocument();
    expect(screen.getByText('Send AI requests · List models')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
  });

  it('creates a key and shows it once', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Create a key' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'billing-api' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByText('aegis_demo_secretvalue')).toBeInTheDocument();
    await waitFor(() => expect(createKey.mock.calls[0][0]).toEqual({ name: 'billing-api', scopes: ['chat', 'models'] }));
  });
});
