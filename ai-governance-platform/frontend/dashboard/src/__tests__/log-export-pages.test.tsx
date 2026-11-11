import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

const dest = {
  destinationId: 'dst_1', name: 'Security SIEM', kind: 'splunk_hec', recordTypes: ['decisions', 'sign_ins'], enabled: true,
  urlHint: 'https://splunk.acme.example:8088', secretHint: '…1234', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  deliveredCount: 1520, deadLetterCount: 3, lastDeliveredAt: '2026-11-06T10:00:00Z',
  retrying: { count: 40, attempts: 2, nextAttemptAt: '2026-11-06T10:05:00Z' }, lastError: 'The destination answered 503: busy',
};
const createDestination = vi.fn(async (..._a: unknown[]) => ({ destination: { ...dest, destinationId: 'dst_2', kind: 'webhook' }, signingSecret: 'whsec_shownonce' }));
const testDestination = vi.fn(async () => ({ ok: false, status: 401, ms: 12, message: 'The destination answered 401: Invalid token' }));
const retryDeadLetter = vi.fn(async () => ({ ok: true, ms: 5, message: 'Delivered 3 records' }));
const listActivity = vi.fn(async (..._a: unknown[]) => ({
  retentionDays: 400,
  items: [
    { eventId: 'a1', time: '2026-11-06T10:00:00Z', category: 'admin', action: 'rule.created', outcome: 'success', actor: { type: 'user', id: 'u1', email: 'ana@acme.example', role: 'tenant_admin' }, target: { policyId: 'pol_1' }, sourceIp: '203.0.113.5', hash: 'h1' },
    { eventId: 'a2', time: '2026-11-06T09:00:00Z', category: 'sign_in', action: 'sign_in.api_key', outcome: 'denied', actor: { type: 'api_key', id: 'key_9', keyId: 'key_9' }, detail: { reason: 'KEY_REVOKED' }, hash: 'h2' },
    { eventId: 'a3', time: '2026-11-06T08:00:00Z', category: 'admin', action: 'user.invited', outcome: 'denied', actor: { type: 'user', id: 'u2', email: 'aud@acme.example', role: 'tenant_auditor' }, detail: { status: 403 }, hash: 'h3' },
  ],
}));
vi.mock('../lib/log-export-api', () => ({
  getLogExport: vi.fn(async () => ({ destinations: [dest], deadLetters: 1, maxDestinations: 5 })),
  listDeadLetters: vi.fn(async () => [{ entryId: 'dl1', destinationId: 'dst_1', destinationName: 'Security SIEM', count: 3, error: 'The destination answered 503: busy', attempts: 5, firstAttemptAt: 'x', lastAttemptAt: 'y', keptUntil: '2026-12-06T00:00:00Z', types: ['decision'], firstRecordAt: '2026-11-05T10:00:00Z', lastRecordAt: '2026-11-05T10:01:00Z' }]),
  createDestination: (...a: unknown[]) => createDestination(...a),
  testDestination: () => testDestination(),
  retryDeadLetter: () => retryDeadLetter(),
  updateDestination: vi.fn(), deleteDestination: vi.fn(), rotateSecret: vi.fn(), getDeadLetter: vi.fn(), discardDeadLetter: vi.fn(),
  listActivity: (...a: unknown[]) => listActivity(...a),
}));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { tenantId: 't' } }) }));
import { LogExportPage } from '../pages/LogExportPage';
import { ActivityPage } from '../pages/ActivityPage';

const renderPage = (page: JSX.Element) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{page}</MemoryRouter></QueryClientProvider>
);

describe('Log export page', () => {
  it('shows each destination with what it sends, how it is doing, and what is waiting', async () => {
    renderPage(<LogExportPage />);
    expect(await screen.findByText('Security SIEM')).toBeInTheDocument();
    expect(screen.getByText('Decisions · Sign-ins')).toBeInTheDocument();
    expect(screen.getByText('1,520')).toBeInTheDocument();
    expect(screen.getByText(/40 records waiting: try 2 failed/)).toBeInTheDocument();
    expect(screen.getByText(/Token …1234/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Not delivered' })).toBeInTheDocument();
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(0);
    expect(screen.getByText('Microsoft Sentinel')).toBeInTheDocument();
  });

  it('reports a failed test in plain words, and resends a dead letter', async () => {
    renderPage(<LogExportPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send a test' }));
    expect(await screen.findByText('Test: The destination answered 401: Invalid token')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Send again' }));
    expect(await screen.findByText('Delivered 3 records')).toBeInTheDocument();
  });

  it('adds a webhook and shows its signing secret once', async () => {
    renderPage(<LogExportPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a destination' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Hook' } });
    fireEvent.change(screen.getByLabelText(/Address/), { target: { value: 'https://hooks.acme.example/in' } });
    fireEvent.click(screen.getByLabelText(/Sign-ins/));
    fireEvent.click(screen.getByRole('button', { name: 'Add destination' }));
    expect(await screen.findByText('whsec_shownonce')).toBeInTheDocument();
    await waitFor(() => expect(createDestination.mock.calls[0][0]).toEqual({ kind: 'webhook', name: 'Hook', url: 'https://hooks.acme.example/in', recordTypes: ['decisions', 'admin_activity'], headers: undefined }));
  });
});

describe('Activity page', () => {
  it('lists changes and sign-ins in plain words, with details on demand', async () => {
    renderPage(<ActivityPage />);
    expect(await screen.findByText('Added a rule')).toBeInTheDocument();
    expect(screen.getByText(/Kept for 400 days/)).toBeInTheDocument();
    expect(screen.getByText('API key refused')).toBeInTheDocument();
    expect(screen.getByText(/the key was revoked/)).toBeInTheDocument();
    expect(screen.getAllByText('Refused')).toHaveLength(2);
    // A refused change must not read as if it happened.
    expect(screen.getByText('Invited a person')).toBeInTheDocument();
    expect(screen.getByText('(tried; nothing changed)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Added a rule/ }));
    expect(screen.getByText('pol_1')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.5')).toBeInTheDocument();
  });

  it('filters by kind', async () => {
    renderPage(<ActivityPage />);
    await screen.findByText('Added a rule');
    fireEvent.click(screen.getByRole('button', { name: 'Sign-ins' }));
    await waitFor(() => expect(listActivity).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'sign_in' })));
  });
});
