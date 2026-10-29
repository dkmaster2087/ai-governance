import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import * as platform from '../lib/platform-api';
import * as licenseApi from '../lib/license-api';
import { needsAttention, PlatformDashboardPage } from '../pages/PlatformDashboardPage';
import { TenantDetailPage } from '../pages/TenantDetailPage';
import { PlatformHealthPage } from '../pages/PlatformHealthPage';
import { TenantsPage } from '../pages/TenantsPage';
import type { License } from '../lib/license-api';

vi.mock('../lib/platform-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/platform-api')>()),
  listTenants: vi.fn(), getTenant: vi.fn(), createTenant: vi.fn(), updateTenant: vi.fn(),
  suspendTenant: vi.fn(), activateTenant: vi.fn(), fetchPlatformUsage: vi.fn(), fetchTenantSetup: vi.fn(), fetchHealth: vi.fn(),
}));
vi.mock('../lib/license-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/license-api')>()),
  fetchAllLicenses: vi.fn(), fetchTenantLicenses: vi.fn(),
}));

const wrap = (ui: React.ReactElement, path = '/') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/tenants/:tenantId" element={ui} /><Route path="*" element={ui} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const tenant = (over: Partial<platform.Tenant> = {}): platform.Tenant => ({
  tenantId: 'tenant_acme', name: 'Acme', adminEmail: 'sec@acme.com', plan: 'enterprise', status: 'active',
  deploymentMode: 'saas', region: 'us-east-1', createdAt: '2026-01-01T00:00:00Z', settings: { governanceFailMode: 'closed', auditLogRetentionDays: 365 }, ...over,
});
const license = (over: Partial<License> = {}): License => ({
  licenseId: 'l1', keyPrefix: 'aegis_…', tenantId: 'tenant_acme', tenantName: 'Acme', status: 'active', issuedAt: '2026-01-01T00:00:00Z',
  expiresAt: '2099-01-01T00:00:00Z', plan: 'enterprise', type: 'cloud', maxUsers: 100,
  reportingConfig: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: false }, ...over,
});
const usage = (requests: number, stopped = 0): platform.PlatformUsage => ({
  from: '', to: '', totals: { requests, stopped, cleaned: 2, cost: 1.5 }, truncated: false,
  days: [{ date: '2026-10-28', requests, stopped }],
  tenants: [{ tenantId: 'tenant_acme', requests, stopped, cleaned: 2, cost: 1.5, lastRequestAt: new Date().toISOString(), truncated: false, models: [{ model: 'gpt-4o', requests, cost: 1.5 }] }],
});

describe('needsAttention', () => {
  const now = new Date('2026-10-29T00:00:00Z').getTime();

  it('flags suspended tenants, open fail mode, expiring and missing licenses, and quiet tenants', () => {
    const items = needsAttention(
      [tenant({ tenantId: 'a', name: 'A', status: 'suspended' }), tenant({ tenantId: 'b', name: 'B', settings: { governanceFailMode: 'open' } }), tenant({ tenantId: 'c', name: 'C' })],
      [license({ licenseId: 'lb', tenantId: 'b', tenantName: 'B', expiresAt: '2026-11-10T00:00:00Z' })],
      [{ tenantId: 'b', requests: 5, stopped: 0, cleaned: 0, cost: 0, lastRequestAt: null, truncated: false, models: [] }],
      now,
    ).map((i) => i.text);
    expect(items).toEqual([
      'A is suspended; every request is refused.',
      'B lets requests through unchecked when a check is down.',
      expect.stringMatching(/^B’s license expires/),
      'C has no active license.',
      'C sent no requests in 30 days.',
    ]);
  });

  it('is empty when all is well', () => {
    expect(needsAttention([tenant()], [license()], usage(3).tenants, now)).toEqual([]);
  });
});

describe('platform pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platform.listTenants).mockResolvedValue([tenant()]);
    vi.mocked(platform.fetchPlatformUsage).mockResolvedValue(usage(120, 7));
    vi.mocked(licenseApi.fetchAllLicenses).mockResolvedValue([license()]);
  });

  it('overview leads with real traffic across tenants', async () => {
    wrap(<PlatformDashboardPage />);
    expect(await screen.findByText(/1 tenant sent 120 AI requests in the last 30 days/)).toBeInTheDocument();
    expect(screen.getByText('7 stopped')).toBeInTheDocument();
    expect(await screen.findByText('Nothing right now.')).toBeInTheDocument();
  });

  it('tenant detail asks before suspending', async () => {
    vi.mocked(platform.getTenant).mockResolvedValue(tenant());
    vi.mocked(platform.fetchTenantSetup).mockResolvedValue({ failMode: 'open', rulesOn: 4, modelsListed: 2, frameworksOn: ['SOC 2'] });
    vi.mocked(licenseApi.fetchTenantLicenses).mockResolvedValue([license()]);
    vi.mocked(platform.suspendTenant).mockResolvedValue({});
    wrap(<TenantDetailPage />, '/tenants/tenant_acme');
    expect(await screen.findByText('Let requests through')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    expect(platform.suspendTenant).not.toHaveBeenCalled();
    expect(screen.getByText(/Every request from their apps is refused/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Suspend' })[0]);
    await waitFor(() => expect(platform.suspendTenant).toHaveBeenCalledWith('tenant_acme'));
  });

  it('adding a tenant shows what to do next', async () => {
    vi.mocked(platform.createTenant).mockResolvedValue(tenant({ tenantId: 'tenant_new', name: 'Newco', adminEmail: 'it@newco.com' }));
    wrap(<TenantsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a tenant' }));
    fireEvent.change(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'Newco' } });
    fireEvent.change(screen.getByPlaceholderText('security@acme.com'), { target: { value: 'it@newco.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tenant' }));
    expect(await screen.findByText(/Newco is set up/)).toBeInTheDocument();
    expect(vi.mocked(platform.createTenant).mock.calls[0][0]).toMatchObject({ name: 'Newco', adminEmail: 'it@newco.com', plan: 'professional' });
  });

  it('health says plainly when a service is down', async () => {
    vi.mocked(platform.fetchHealth).mockResolvedValue({
      status: 'degraded', version: '1.0.0', uptime: 7200,
      dependencies: [{ name: 'dynamodb', status: 'healthy', latencyMs: 12 }, { name: 'policy-engine', status: 'unhealthy', error: 'connect ECONNREFUSED' }],
    });
    wrap(<PlatformHealthPage />);
    expect(await screen.findByText('Policy engine is down.')).toBeInTheDocument();
    expect(screen.getByText('connect ECONNREFUSED')).toBeInTheDocument();
  });

  it('health says when the gateway itself is not answering', async () => {
    vi.mocked(platform.fetchHealth).mockRejectedValue(new Error('Network Error'));
    wrap(<PlatformHealthPage />);
    expect(await screen.findByText('The gateway isn’t answering.')).toBeInTheDocument();
  });
});
