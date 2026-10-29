import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { StoppedSummary } from '../lib/gateway-api';

const summary: StoppedSummary = {
  from: '2026-10-21T00:00:00Z', to: '2026-10-28T00:00:00Z', truncated: false, total: 27,
  byCheck: { policy: 27, secrets: { active: false, stopped: 0 } },
  byDay: [{ date: '2026-10-27', count: 20 }, { date: '2026-10-28', count: 7 }],
  causes: [
    { key: 'rule_kw', reason: 'Block confidential keywords', ruleType: 'keyword_block', check: 'policy', count: 25,
      apps: [{ name: 'billing-api', count: 20 }, { name: 'support-bot', count: 5 }], people: 4, topPeople: ['j.patel'],
      latest: { time: '2026-10-28T10:00:00Z', app: 'billing-api', user: 'j.patel', model: 'gpt-4o', evidence: { before: 'Summarise the ', hit: 'confidential', after: ' memo' } } },
    { key: 'rule_old', reason: 'rule_old', check: 'policy', count: 2, apps: [{ name: 'hr-assistant', count: 2 }], people: 1, topPeople: ['m.chen'],
      latest: { time: '2026-10-27T10:00:00Z', app: 'hr-assistant', user: 'm.chen', model: 'gpt-4o' } },
  ],
};

vi.mock('../lib/gateway-api', async (orig) => ({ ...(await orig<typeof import('../lib/gateway-api')>()), fetchStopped: vi.fn(async () => summary) }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { tenantId: 't', tenantName: 'Demo Corp' }, isAdmin: true }) }));

import { StoppedPage } from '../pages/StoppedPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><StoppedPage /></MemoryRouter></QueryClientProvider>);
}

describe('StoppedPage', () => {
  it('leads with the total and groups by cause', async () => {
    renderPage();
    expect(await screen.findByText(/requests stopped in the last 7 days/)).toBeInTheDocument();
    expect(screen.getByText('Block confidential keywords')).toBeInTheDocument();
    expect(screen.getByText('billing-api (20) · support-bot (5) · 4 people, mostly j.patel')).toBeInTheDocument();
  });

  it('highlights what triggered the rule', async () => {
    renderPage();
    const hit = await screen.findByText('confidential');
    expect(hit.tagName).toBe('MARK');
  });

  it('says plainly when no excerpt exists', async () => {
    renderPage();
    expect(await screen.findByText(/No excerpt kept for these requests/)).toBeInTheDocument();
  });

  it('shows secrets as not active rather than zero', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Secrets · not active yet' })).toBeDisabled();
  });
});
