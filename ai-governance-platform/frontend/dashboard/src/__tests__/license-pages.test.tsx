import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { License, LicenseStatus } from '../lib/license-api';

const license: License = {
  licenseId: 'lic1', keyPrefix: 'pbl_acme_ab...', tenantId: 't', tenantName: 'Acme', status: 'active', issuedAt: '2026-10-01T00:00:00Z',
  activatedAt: '2026-10-02T00:00:00Z', expiresAt: '2027-10-01T00:00:00Z', plan: 'enterprise', type: 'onprem', maxUsers: 200,
  reportingConfig: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: false },
};
const setReporting = vi.fn(async (_c: unknown) => ({}));
const activateLicense = vi.fn(async (_k: string): Promise<unknown> => ({ license: { ...license, plan: 'professional' }, status: { state: 'active' } }));
const removeLicense = vi.fn(async (_id: string) => ({}));
let overview: { status: LicenseStatus; licenses: License[] } = { status: { state: 'active', endsAt: license.expiresAt }, licenses: [license] };
let admin = true;
vi.mock('../lib/license-api', async (orig) => ({
  ...(await orig<typeof import('../lib/license-api')>()),
  fetchLicenseOverview: vi.fn(async () => overview),
  setReporting: (c: unknown) => setReporting(c),
  activateLicense: (k: string) => activateLicense(k),
  removeLicense: (id: string) => removeLicense(id),
}));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { tenantId: 't' }, isAdmin: admin }) }));
import { TenantLicensePage } from '../pages/TenantLicensePage';

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><TenantLicensePage /></MemoryRouter></QueryClientProvider>
);

describe('Tenant license page', () => {
  beforeEach(() => {
    vi.clearAllMocks(); admin = true;
    overview = { status: { state: 'active', endsAt: license.expiresAt }, licenses: [license] };
  });

  it('shows the active license, never the key, and what the on-prem agent may report', async () => {
    renderPage();
    expect(await screen.findByText(/Your license is active until/)).toBeInTheDocument();
    expect(screen.getByText('enterprise plan')).toBeInTheDocument();
    expect(screen.getByText('pbl_acme_ab...')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Audit records' }));
    await waitFor(() => expect(setReporting).toHaveBeenCalledWith({ ...license.reportingConfig, auditLogs: true }));
  });

  it('lets an admin enter the key their provider sent', async () => {
    overview = { status: { state: 'grace', reason: 'none', graceUntil: '2026-12-06T00:00:00Z', daysLeft: 30 }, licenses: [] };
    renderPage();
    expect(await screen.findByText('Your company hasn’t entered a Probaline license yet.')).toBeInTheDocument();
    const form = screen.getByRole('region', { name: 'Enter a license key' });
    fireEvent.change(within(form).getByLabelText('License key'), { target: { value: '  pbl_acme_newkey  ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add license' }));
    await waitFor(() => expect(activateLicense).toHaveBeenCalledWith('pbl_acme_newkey'));
    expect(await within(form).findByText(/License added: professional plan/)).toBeInTheDocument();
  });

  it('shows an ended license as expired, and lets an admin remove the active one', async () => {
    overview = {
      status: { state: 'active', endsAt: license.expiresAt },
      licenses: [license, { ...license, licenseId: 'old', status: 'revoked', revokedAt: '2026-09-01T00:00:00Z', plan: 'starter' }],
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const earlier = await screen.findByRole('region', { name: 'Earlier licenses' });
    expect(within(earlier).getByText(/Expired · ended/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeLicense).toHaveBeenCalledWith('lic1'));
  });

  it('tells auditors only an admin can enter a key', async () => {
    admin = false;
    overview = { status: { state: 'lapsed', reason: 'expired', graceUntil: '2026-10-01T00:00:00Z' }, licenses: [] };
    renderPage();
    expect(await screen.findByText('Your Probaline license has expired, and AI requests have stopped.')).toBeInTheDocument();
    expect(screen.getByText('Only an administrator can enter a license key.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Enter a license key' })).toBeNull();
  });
});
