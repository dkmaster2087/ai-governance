import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

let role = 'tenant_admin';
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { role, name: 'Demo Admin', tenantName: 'Demo Corp' }, logout: () => {} }) }));
import { Shell } from '../components/layout/Shell';

describe('Shell', () => {
  it('logo links home for tenants', () => {
    role = 'tenant_admin';
    render(<MemoryRouter initialEntries={['/rules']}><Shell><div /></Shell></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Aegis home' })).toHaveAttribute('href', '/gateway');
  });

  it('logo links to the platform dashboard for platform admins', () => {
    role = 'platform_admin';
    render(<MemoryRouter><Shell><div /></Shell></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Aegis home' })).toHaveAttribute('href', '/overview');
  });

  it('shows the redesigned navigation', () => {
    role = 'tenant_admin';
    render(<MemoryRouter><Shell><div /></Shell></MemoryRouter>);
    for (const name of ['Gateway', 'Stopped', 'Shadow AI', 'Rules', 'Evidence']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
  });
});
