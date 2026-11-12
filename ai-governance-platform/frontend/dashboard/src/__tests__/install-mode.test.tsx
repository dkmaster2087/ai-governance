import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

// A customer-run install's build: the gateway serving the dashboard signs people in.
vi.mock('../lib/auth-mode', () => ({ AUTH_MODE: 'install', DEV_AUTH: false }));

const people = [{ email: 'jane@acme.example', givenName: 'Jane', familyName: 'Doe', role: 'tenant_auditor', status: 'active', invitedAt: '', invitedBy: '' }];
const inviteUser = vi.fn(async (..._a: unknown[]) => ({ ...people[0], email: 'new@acme.example', status: 'invited', temporaryPassword: 'abc123-def456-7Q' }));
const resendInvite = vi.fn(async (..._a: unknown[]) => ({ ok: true, temporaryPassword: 'zzz999-yyy888-7Q' }));
vi.mock('../lib/users-api', () => ({
  listUsers: vi.fn(async () => ({ managed: true, users: people })),
  inviteUser: (...a: unknown[]) => inviteUser(...a), changeUser: vi.fn(), removeUser: vi.fn(),
  resendInvite: (...a: unknown[]) => resendInvite(...a), announceSignIn: vi.fn(),
}));
vi.mock('../lib/install-session', async (orig) => ({
  ...(await orig<typeof import('../lib/install-session')>()),
  signInMethods: vi.fn(async () => ({ password: true, sso: { name: 'Acme Okta' } })),
}));
vi.mock('../lib/auth', async (orig) => ({
  ...(await orig<typeof import('../lib/auth')>()),
  usersManagedExternally: true,
  useAuth: () => ({ user: { tenantId: 't', tenantName: 'Acme', email: 'boss@acme.example' }, login: vi.fn(), completeChallenge: vi.fn() }),
}));
vi.mock('../lib/theme', () => ({ useTheme: () => ({ isDark: false }) }));
import { claimsOf, sessionFromToken } from '../lib/install-session';
import { LoginPage } from '../pages/LoginPage';
import { UsersPage } from '../pages/UsersPage';

const wrap = (el: JSX.Element) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>);
const token = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;

describe('a customer-run install', () => {
  it('reads its own session tokens', () => {
    const t = token({ email: 'jane@acme.example', 'custom:role': 'tenant_admin', exp: 2_000_000_000 });
    expect(claimsOf(t)).toMatchObject({ email: 'jane@acme.example' });
    expect(sessionFromToken(t)).toEqual({ token: t, expiresAt: new Date(2_000_000_000_000).toISOString() });
    expect(sessionFromToken('not-a-token')).toBeNull();
  });

  it('offers company sign-in when it’s set up, and shows an error handed back from it', async () => {
    window.history.replaceState(null, '', '/login#error=jane%40acme.example%20isn%E2%80%99t%20a%20Probaline%20user%20here.');
    wrap(<LoginPage />);
    expect(await screen.findByRole('link', { name: 'Sign in with Acme Okta' })).toHaveAttribute('href', '/api/v1/auth/sso/start');
    expect(screen.getByText('jane@acme.example isn’t a Probaline user here.')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  it('shows a new person’s temporary password once, and makes a new one on request', async () => {
    wrap(<UsersPage />);
    expect(await screen.findByText(/shown to you once to pass on/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add someone' }));
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Person' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@acme.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('abc123-def456-7Q')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New temporary password' }));
    await waitFor(() => expect(resendInvite).toHaveBeenCalled());
    expect(await screen.findByText('zzz999-yyy888-7Q')).toBeInTheDocument();
  });
});
