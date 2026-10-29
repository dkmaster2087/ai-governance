import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { License } from '../lib/license-api';

const license: License = {
  licenseId: 'lic1', keyPrefix: 'aegis_acme_ab...', tenantId: 't', tenantName: 'Acme', status: 'active', issuedAt: '2026-10-01T00:00:00Z',
  expiresAt: '2027-10-01T00:00:00Z', plan: 'enterprise', type: 'onprem', maxUsers: 200,
  reportingConfig: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: false },
};
const setReporting = vi.fn(async (_c: unknown) => ({}));
let mine: License | null = license;
vi.mock('../lib/license-api', async (orig) => ({
  ...(await orig<typeof import('../lib/license-api')>()),
  fetchMyLicense: vi.fn(async () => mine),
  setReporting: (c: unknown) => setReporting(c),
}));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { tenantId: 't' }, isAdmin: true }) }));
import { TenantLicensePage } from '../pages/TenantLicensePage';

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><TenantLicensePage /></MemoryRouter></QueryClientProvider>
);

describe('Tenant license page', () => {
  it('shows the real license, never the key', async () => {
    mine = license;
    renderPage();
    expect(await screen.findByText('enterprise plan')).toBeInTheDocument();
    expect(screen.getByText('aegis_acme_ab...')).toBeInTheDocument();
    expect(screen.getByText('In your own AWS account')).toBeInTheDocument();
  });

  it('saves what the on-prem agent may report', async () => {
    mine = license;
    renderPage();
    fireEvent.click(await screen.findByRole('switch', { name: 'Audit records' }));
    await waitFor(() => expect(setReporting).toHaveBeenCalledWith({ ...license.reportingConfig, auditLogs: true }));
  });

  it('says plainly when no license exists', async () => {
    mine = null;
    renderPage();
    expect(await screen.findByText('No license has been issued for your company yet.')).toBeInTheDocument();
  });
});
