import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

let role = 'tenant_admin';
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { role, name: 'Demo Admin', tenantName: 'Demo Corp' }, logout: () => {} }) }));
let licenseStatus: object = { state: 'active' };
vi.mock('../lib/license-api', async (orig) => ({ ...(await orig<typeof import('../lib/license-api')>()), fetchLicenseStatus: vi.fn(async () => licenseStatus) }));
let approvals: Array<{ status: string }> = [];
vi.mock('../lib/mcp-api', async (orig) => ({ ...(await orig<typeof import('../lib/mcp-api')>()), listApprovals: vi.fn(async () => approvals) }));
import { NAV, Shell, findPage } from '../components/layout/Shell';

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

  it('shows five sections to a company admin, with set-up pages behind the gear', () => {
    role = 'tenant_admin';
    render(<QueryClientProvider client={qc()}><MemoryRouter><Shell><div /></Shell></MemoryRouter></QueryClientProvider>);
    const main = screen.getByRole('navigation', { name: 'Main' });
    expect([...main.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Overview', 'AI use', 'Controls', 'Audit']);
    expect(screen.getByRole('link', { name: 'Audit' })).toHaveAttribute('href', '/evidence');
    expect(screen.getByLabelText('Admin')).toBeInTheDocument();
    expect(screen.queryByText('More')).toBeNull();
  });

  it('shows the section’s pages as tabs, with the current one marked', () => {
    role = 'tenant_admin';
    render(<QueryClientProvider client={qc()}><MemoryRouter initialEntries={['/compliance']}><Shell><div /></Shell></MemoryRouter></QueryClientProvider>);
    const tabs = screen.getByRole('navigation', { name: 'Audit pages' });
    expect([...tabs.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Case files', 'Stopped', 'Compliance', 'Activity', 'Log export']);
    expect(screen.getByRole('link', { name: 'Compliance' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Audit' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps every page at its old address, and puts MCP pages under Controls', () => {
    const nav = NAV.tenant_admin;
    for (const path of ['/gateway', '/cost', '/shadow-ai', '/enforcement', '/rules', '/models', '/mcp', '/alerts', '/evidence', '/stopped', '/compliance', '/activity', '/log-export', '/users', '/keys', '/license', '/settings']) {
      expect(findPage(nav, path)).not.toBeNull();
    }
    expect(findPage(nav, '/mcp/approvals')?.section?.label).toBe('Controls');
    expect(findPage(nav, '/mcp/srv_1')?.tab.label).toBe('MCP servers');
    expect(findPage(nav, '/keys')?.section).toBeNull();
  });

  it('gives auditors only Overview and Audit', () => {
    role = 'tenant_auditor';
    render(<QueryClientProvider client={qc()}><MemoryRouter initialEntries={['/gateway']}><Shell><div /></Shell></MemoryRouter></QueryClientProvider>);
    const main = screen.getByRole('navigation', { name: 'Main' });
    expect([...main.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Overview', 'Audit']);
    expect(screen.queryByLabelText('Admin')).toBeNull();
  });

  it('shows approvals waiting on every page, and nothing when none wait', async () => {
    role = 'tenant_admin';
    approvals = [{ status: 'pending' }, { status: 'pending' }, { status: 'approved' }];
    render(<QueryClientProvider client={qc()}><MemoryRouter initialEntries={['/rules']}><Shell><div /></Shell></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole('link', { name: /2 approvals waiting/ })).toHaveAttribute('href', '/mcp/approvals');
    approvals = [];
  });

  it('closes the admin and account menus on a click elsewhere or Escape', () => {
    role = 'tenant_admin';
    render(<QueryClientProvider client={qc()}><MemoryRouter><Shell><p>Page</p></Shell></MemoryRouter></QueryClientProvider>);
    const admin = screen.getByLabelText('Admin').closest('details')!;
    const account = screen.getByText('Account menu').closest('details')!;
    admin.setAttribute('open', '');
    fireEvent.pointerDown(admin.querySelector('a')!); // inside: stays open
    expect(admin.open).toBe(true);
    fireEvent.pointerDown(screen.getByText('Page'));
    expect(admin.open).toBe(false);
    account.setAttribute('open', '');
    admin.setAttribute('open', '');
    fireEvent.pointerDown(admin.querySelector('summary')!); // opening one closes the other
    expect(account.open).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(admin.open).toBe(false);
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
