import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { AlertEvent, AlertRule } from '../lib/alerts-api';

let rules: AlertRule[] = [];
let events: AlertEvent[] = [];
const createAlert = vi.fn(async (_i: unknown): Promise<any> => ({ ruleId: 'alert_new', signingSecret: 'whsec_shown_once' }));
const updateAlert = vi.fn(async (_id: string, _c: unknown): Promise<any> => ({}));
const testAlert = vi.fn(async (_id: string) => ({ delivery: { email: 'sent' as const, webhook: 'failed' as const, error: 'The webhook answered 404' } }));
vi.mock('../lib/alerts-api', async (orig) => ({
  ...(await orig<typeof import('../lib/alerts-api')>()),
  listAlerts: vi.fn(async () => rules),
  listAlertEvents: vi.fn(async () => events),
  createAlert: (i: unknown) => createAlert(i),
  updateAlert: (id: string, c: unknown) => updateAlert(id, c),
  testAlert: (id: string) => testAlert(id),
  deleteAlert: vi.fn(async () => ({})),
}));
import { AlertsPage } from '../pages/AlertsPage';

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AlertsPage /></MemoryRouter></QueryClientProvider>
);
const spike: AlertRule = {
  ruleId: 'alert_1', name: 'Stops', kind: 'stopped_spike', enabled: true, config: { count: 10, minutes: 60 }, emails: ['sec@acme.example'],
  webhook: 'https://hooks.slack.example/services/T0…', description: '10 or more requests stopped within 1 hour', createdAt: '', firedCount: 2, lastFiredAt: '2026-11-07T10:00:00Z',
};

describe('Alerts page', () => {
  beforeEach(() => { vi.clearAllMocks(); rules = []; events = []; });

  it('says when nothing is set up, and adds a spend alert', async () => {
    renderPage();
    expect(await screen.findByText('No alerts on yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New alert' }));
    fireEvent.click(screen.getByRole('radio', { name: /Spend near budget/ }));
    fireEvent.change(screen.getByLabelText('Monthly AI budget ($)'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'cfo@acme.example, ciso@acme.example' } });
    fireEvent.change(screen.getByLabelText(/^Webhook/), { target: { value: 'https://hooks.slack.example/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add alert' }));
    await waitFor(() => expect(createAlert).toHaveBeenCalled());
    expect(createAlert.mock.calls[0][0]).toEqual({
      name: 'Spend near budget', kind: 'spend', config: { monthlyBudgetUSD: 5000, percent: 80 },
      emails: ['cfo@acme.example', 'ciso@acme.example'], webhookUrl: 'https://hooks.slack.example/x',
    });
    expect(await screen.findByText('whsec_shown_once')).toBeInTheDocument();
  });

  it('needs an email or a webhook before saving', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New alert' }));
    expect(screen.getByRole('button', { name: 'Add alert' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'sec@acme.example' } });
    expect(screen.getByRole('button', { name: 'Add alert' })).toBeEnabled();
  });

  it('lists alerts, turns one off, sends a test and shows what failed, and lists what was sent', async () => {
    rules = [spike];
    events = [{ alertId: 'e1', alertRuleId: 'alert_1', name: 'Stops', kind: 'stopped_spike', title: '10 requests stopped in the last 1 hour', message: '', firedAt: '2026-11-07T10:00:00Z', delivery: { email: 'sent' } }];
    renderPage();
    const list = await screen.findByRole('region', { name: 'Your alerts' });
    expect(within(list).getByText('10 or more requests stopped within 1 hour')).toBeInTheDocument();
    expect(within(list).getByText(/To sec@acme.example, https:\/\/hooks.slack.example/)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('switch', { name: 'Stops on' }));
    await waitFor(() => expect(updateAlert).toHaveBeenCalledWith('alert_1', { enabled: false }));
    fireEvent.click(within(list).getByRole('button', { name: 'Send a test' }));
    expect(await within(list).findByText(/Test: email sent, webhook failed \(The webhook answered 404\)/)).toBeInTheDocument();
    const sent = screen.getByRole('region', { name: 'Recently sent' });
    expect(within(sent).getByText('10 requests stopped in the last 1 hour')).toBeInTheDocument();
  });
});
