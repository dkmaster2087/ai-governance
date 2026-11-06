import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

let role = 'tenant_admin';
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { role, name: 'Demo Admin', tenantName: 'Demo Corp' }, logout: () => {} }) }));
let licenseStatus: object = { state: 'active' };
vi.mock('../lib/license-api', async (orig) => ({ ...(await orig<typeof import('../lib/license-api')>()), fetchLicenseStatus: vi.fn(async () => licenseStatus) }));
import { Shell } from '../components/layout/Shell';

const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('Shell', () => {
  it('logo links home for tenants', () => {
    role = 'tenant_admin';
    render(<QueryClientProvider client={qc()}><MemoryRouter initialEntries={['/rules']}><Shell><div /></Shell></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole('link', { name: 'Probaline home' })).toHaveAttribute('href', '/gateway');
  });

  it('logo links to the platform dashboard for platform admins', () => {
    role = 'platform_admin';
    render(<QueryClientProvider client={qc()}><MemoryRouter><Shell><div /></Shell></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole('link', { name: 'Probaline home' })).toHaveAttribute('href', '/overview');
  });

  it('shows the redesigned navigation', () => {
    role = 'tenant_admin';
    render(<QueryClientProvider client={qc()}><MemoryRouter><Shell><div /></Shell></MemoryRouter></QueryClientProvider>);
    for (const name of ['Gateway', 'Stopped', 'Shadow AI', 'Rules', 'Evidence']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('closes the More and account menus on a click elsewhere or Escape', () => {
    role = 'tenant_admin';
    render(<QueryClientProvider client={qc()}><MemoryRouter><Shell><p>Page</p></Shell></MemoryRouter></QueryClientProvider>);
    const more = screen.getByText('More').closest('details')!;
    const account = screen.getByText('Account menu').closest('details')!;
    more.setAttribute('open', '');
    fireEvent.pointerDown(more.querySelector('a')!); // inside: stays open
    expect(more.open).toBe(true);
    fireEvent.pointerDown(screen.getByText('Page'));
    expect(more.open).toBe(false);
    account.setAttribute('open', '');
    more.setAttribute('open', '');
    fireEvent.pointerDown(more.querySelector('summary')!); // opening one closes the other
    expect(account.open).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(more.open).toBe(false);
  });

  it('tells a company its license has expired, how long is left, and where to enter a key', async () => {
    role = 'tenant_admin';
    licenseStatus = { state: 'grace', reason: 'revoked', endedAt: '2026-11-06T00:00:00Z', graceUntil: '2026-12-06T00:00:00Z', daysLeft: 30 };
    render(<QueryClientProvider client={qc()}><MemoryRouter><Shell><p>Page</p></Shell></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText(/Your Probaline license has expired/)).toBeInTheDocument();
    expect(screen.getByText(/Everything keeps working until .*30 days from now. After that, AI requests through Probaline stop/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Enter a license key' })).toHaveAttribute('href', '/license');
  });

  it('says plainly when AI requests have stopped; auditors are told to ask an admin', async () => {
    role = 'tenant_auditor';
    licenseStatus = { state: 'lapsed', reason: 'expired', graceUntil: '2026-10-01T00:00:00Z' };
    render(<QueryClientProvider client={qc()}><MemoryRouter><Shell><p>Page</p></Shell></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole('alert', { name: 'License' })).toHaveTextContent(/AI requests have stopped.*Ask your administrator/);
    expect(screen.queryByRole('link', { name: 'Enter a license key' })).toBeNull();
    licenseStatus = { state: 'active' };
  });
});
