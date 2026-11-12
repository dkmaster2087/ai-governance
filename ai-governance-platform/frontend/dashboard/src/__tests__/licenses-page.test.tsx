import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { License } from '../lib/license-api';

const fileLicense: License = {
  licenseId: 'lic_9', keyPrefix: 'lic_9', tenantId: 'tenant_acme', tenantName: 'Acme', status: 'active', issuedAt: '2026-11-12T00:00:00Z',
  expiresAt: '2027-11-12T00:00:00Z', plan: 'enterprise', type: 'onprem', file: true, addresses: ['ai-gateway.acme.com'],
};
const issueLicense = vi.fn(async (..._a: unknown[]) => ({ ...fileLicense, licenseFile: 'PBL1.payload.signature' }));
vi.mock('../lib/license-api', async (orig) => ({
  ...(await orig<typeof import('../lib/license-api')>()),
  fetchAllLicenses: vi.fn(async () => [fileLicense]),
  issueLicense: (...a: unknown[]) => issueLicense(...a),
}));
vi.mock('../lib/tenant-api', () => ({ fetchTenants: vi.fn(async () => [{ tenantId: 'tenant_acme', name: 'Acme' }]) }));
import { LicensesPage } from '../pages/LicensesPage';

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><LicensesPage /></MemoryRouter></QueryClientProvider>
);

describe('Licenses page (platform admins)', () => {
  it('lists customer-run licenses with their gateway address and a download, and no revoke', async () => {
    renderPage();
    expect(await screen.findByText('ai-gateway.acme.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download file' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('issues a license file for the gateway address the admin enters', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Issue a license' }));
    const form = screen.getByRole('region', { name: 'Issue a license' });
    fireEvent.change(within(form).getAllByRole('combobox')[0], { target: { value: 'tenant_acme' } });
    fireEvent.change(within(form).getAllByRole('combobox')[2], { target: { value: 'onprem' } });
    fireEvent.change(within(form).getByPlaceholderText('ai-gateway.customer.com'), { target: { value: 'ai-gateway.acme.com, gw.internal.acme.com' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Issue' }));
    await waitFor(() => expect(issueLicense).toHaveBeenCalled());
    expect(issueLicense.mock.calls[0][1]).toMatchObject({ type: 'onprem', addresses: ['ai-gateway.acme.com', 'gw.internal.acme.com'] });
    expect(await screen.findByText(/License file for Acme/)).toBeInTheDocument();
    expect(screen.getByText('PBL1.payload.signature')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });
});
