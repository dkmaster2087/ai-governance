import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

let role = 'tenant_admin';
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { role, name: 'Demo Admin', tenantName: 'Demo Corp' }, logout: () => {} }) }));
import { Shell } from '../components/layout/Shell';

describe('Shell', () => {
  it('logo links home for tenants', () => {
    role = 'tenant_admin';
    render(<MemoryRouter initialEntries={['/rules']}><Shell><div /></Shell></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Probaline home' })).toHaveAttribute('href', '/gateway');
  });

  it('logo links to the platform dashboard for platform admins', () => {
    role = 'platform_admin';
    render(<MemoryRouter><Shell><div /></Shell></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Probaline home' })).toHaveAttribute('href', '/overview');
  });

  it('shows the redesigned navigation', () => {
    role = 'tenant_admin';
    render(<MemoryRouter><Shell><div /></Shell></MemoryRouter>);
    for (const name of ['Gateway', 'Stopped', 'Shadow AI', 'Rules', 'Evidence']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('closes the More and account menus on a click elsewhere or Escape', () => {
    role = 'tenant_admin';
    render(<MemoryRouter><Shell><p>Page</p></Shell></MemoryRouter>);
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
});
