import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

const people = [
  { email: 'boss@acme.example', givenName: 'Bea', familyName: 'Boss', role: 'tenant_admin', status: 'active', invitedAt: '', invitedBy: '' },
  { email: 'jane@acme.example', givenName: 'Jane', familyName: 'Doe', role: 'tenant_auditor', status: 'invited', invitedAt: '', invitedBy: '' },
];
const inviteUser = vi.fn(async (..._a: unknown[]) => ({}));
const changeUser = vi.fn(async (..._a: unknown[]) => ({}));
const resendInvite = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock('../lib/users-api', () => ({
  listUsers: vi.fn(async () => ({ managed: true, users: people })),
  inviteUser: (...a: unknown[]) => inviteUser(...a), changeUser: (...a: unknown[]) => changeUser(...a),
  removeUser: vi.fn(), resendInvite: (...a: unknown[]) => resendInvite(...a), announceSignIn: vi.fn(),
}));
vi.mock('../lib/auth', async (orig) => ({
  ...(await orig<typeof import('../lib/auth')>()),
  usersManagedExternally: true,
  useAuth: () => ({ user: { tenantId: 't', tenantName: 'Acme', email: 'boss@acme.example' } }),
}));
import { UsersPage } from '../pages/UsersPage';

const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><UsersPage /></MemoryRouter></QueryClientProvider>);

describe('Users page (deployed)', () => {
  it('lists people with their status, and invites someone by email', async () => {
    renderPage();
    expect(await screen.findByText('2 people can sign in to Acme.')).toBeInTheDocument();
    expect(screen.getByText('Invited')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Invite someone' }));
    const form = screen.getByRole('region', { name: 'Invite someone' });
    fireEvent.change(within(form).getByLabelText('First name'), { target: { value: 'Max' } });
    fireEvent.change(within(form).getByLabelText('Last name'), { target: { value: 'Weber' } });
    fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'max@acme.example' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(inviteUser).toHaveBeenCalledWith({ givenName: 'Max', familyName: 'Weber', email: 'max@acme.example', role: 'tenant_auditor' }));
  });

  it('changes roles and resends invitations for others, never for yourself', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Role for jane@acme.example'), { target: { value: 'tenant_admin' } });
    await waitFor(() => expect(changeUser).toHaveBeenCalledWith('jane@acme.example', { role: 'tenant_admin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resend invitation' }));
    await waitFor(() => expect(resendInvite).toHaveBeenCalledWith('jane@acme.example'));
    expect(screen.queryByLabelText('Role for boss@acme.example')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove boss@acme.example' })).toBeNull();
  });
});
