import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { EvidenceList, EvidenceRecord } from '../lib/evidence-api';

const list: EvidenceList = {
  total: 2, nextOffset: null, truncated: false,
  items: [
    { requestId: 'req-1', time: '2026-10-28T10:00:00Z', outcome: 'stopped', app: 'billing-api', user: 'j.patel', model: 'gpt-4o', reason: 'Block confidential keywords' },
    { requestId: 'req-2', time: '2026-10-28T09:00:00Z', outcome: 'cleaned', app: 'support-bot', user: 'm.chen', model: 'gpt-4o-mini' },
  ],
};
const record: EvidenceRecord = {
  requestId: 'req-1', outcome: 'stopped', headline: 'A billing-api prompt was stopped and never reached OpenAI.', time: '2026-10-28T10:00:00Z',
  app: 'billing-api', user: 'j.patel', provider: 'OpenAI', model: 'gpt-4o', reason: 'Block confidential keywords',
  excerpt: { before: 'Summarise the ', hit: 'confidential', after: ' memo' },
  steps: [{ label: 'Received', detail: 'from billing-api.', kind: 'neutral' }, { label: 'Stopped by a policy rule', detail: '“Block confidential keywords”.', kind: 'stopped' }],
  proof: { promptFingerprint: '9b1e0c04f0000000000000', recordedAt: '2026-10-28T10:00:00Z', keptUntil: '2027-10-28T10:00:00Z', triggeredRules: ['r_kw'] },
};
vi.mock('../lib/evidence-api', () => ({
  fetchEvidence: vi.fn(async () => list),
  fetchEvidenceRecord: vi.fn(async () => record),
  downloadEvidence: vi.fn(async () => {}),
}));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { tenantId: 't' } }) }));
import { EvidencePage } from '../pages/EvidencePage';

const renderPage = (url = '/evidence') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[url]}><EvidencePage /></MemoryRouter>
  </QueryClientProvider>
);

describe('Evidence page', () => {
  it('lists decisions as sentences', async () => {
    renderPage();
    expect(await screen.findByText(/a billing-api request: Block confidential keywords\./)).toBeInTheDocument();
    expect(screen.getByText('2 records')).toBeInTheDocument();
  });

  it('opens the newest record as a case file with the trigger highlighted', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: record.headline })).toBeInTheDocument();
    expect(screen.getByText('confidential').tagName).toBe('MARK');
    expect(screen.getByText('Stopped by a policy rule')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download evidence' })).toBeInTheDocument();
  });

  it('takes the outcome filter from the link', async () => {
    renderPage('/evidence?outcome=stopped&q=confidential');
    expect(await screen.findByRole('button', { name: 'Stopped' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('searchbox')).toHaveValue('confidential');
  });
});
