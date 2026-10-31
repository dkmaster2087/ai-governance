import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { ShadowAiSummary } from '../lib/shadow-api';

const summary: ShadowAiSummary = {
  from: '', to: '', mode: 'monitor', retentionDays: 30,
  totals: { people: 7, visits: 20, blockedVisits: 0 },
  tools: [
    { id: 'chatgpt', name: 'ChatGPT', domains: ['chatgpt.com'], visits: 12, people: 5, blockedVisits: 0, previousVisits: 4, decision: 'undecided' },
    { id: 'deepseek', name: 'DeepSeek', domains: ['chat.deepseek.com'], visits: 0, people: 0, blockedVisits: 0, previousVisits: null, decision: 'blocked' },
  ],
  people: [{ user: 'm.okoro', visits: 6, tools: ['ChatGPT'] }],
};
const update = vi.fn(async (_change: unknown) => ({}));
const policy = { mode: 'monitor', decisions: {}, guidance: { message: 'Use the approved tools.', links: [{ name: 'Acme Assistant', url: 'https://assistant.acme.example' }] } };
vi.mock('../lib/shadow-api', () => ({
  fetchShadowSummary: vi.fn(async () => summary),
  fetchShadowPolicy: vi.fn(async () => policy),
  updateShadowPolicy: (c: unknown) => update(c),
}));
let admin = true;
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { tenantId: 't' }, isAdmin: admin }) }));

import { ShadowAiPage } from '../pages/TenantShadowPage';

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ShadowAiPage /></MemoryRouter>
  </QueryClientProvider>
);

describe('Shadow AI page', () => {
  beforeEach(() => { update.mockClear(); admin = true; });

  it('leads with how many people went around the gateway', async () => {
    renderPage();
    expect(await screen.findByText(/used AI tools that go/)).toHaveTextContent('7 people used AI tools that go around the gateway in the last 7 days.');
    expect(screen.getByText('+8')).toBeInTheDocument();
  });

  it('saves a block decision for a tool', async () => {
    renderPage();
    const card = (await screen.findByRole('heading', { name: 'ChatGPT' })).closest('article')!;
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Block' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ decisions: { chatgpt: 'blocked' } }));
  });

  it('lets an admin undo a block', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Unblock' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ decisions: { deepseek: null } }));
  });

  it('hides decision buttons from non-admins', async () => {
    admin = false;
    renderPage();
    await screen.findByRole('heading', { name: 'ChatGPT' });
    expect(screen.queryByRole('button', { name: 'Block' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unblock' })).toBeNull();
  });

  it('shows and saves what blocked employees see', async () => {
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Block page' }).catch(() => null) ?? (await screen.findByLabelText('Block page'));
    expect(await within(panel).findByText('“Use the approved tools.”')).toBeInTheDocument();
    expect(within(panel).getByText(/Acme Assistant/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(panel).getByLabelText('Message'), { target: { value: 'Please use Acme Assistant.' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({
      guidance: { message: 'Please use Acme Assistant.', links: [{ name: 'Acme Assistant', url: 'https://assistant.acme.example' }] },
    }));
  });

  it('doesn’t let non-admins edit the block page', async () => {
    admin = false;
    renderPage();
    const panel = await screen.findByLabelText('Block page');
    await within(panel).findByText('“Use the approved tools.”');
    expect(within(panel).queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});
