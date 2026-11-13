import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

const review = {
  published: { version: '2026-11-13.093015', sequence: 1, publishedAt: '2026-11-13T09:30:15Z', services: 44, by: 'Probaline (new version)' },
  unpublished: { added: ['newco'], changed: [], removed: [], advisories: false, any: true },
  services: [], advisories: [],
  candidates: { new: 1, classified: 1, dismissed: 3, approved: 0, rejected: 0 },
  discovery: true, classifier: true,
  sources: [
    { name: 'models-dev', label: 'models.dev provider list', everyMinutes: 60, lastRunAt: '2026-11-13T09:00:00Z', lastResult: 'ok', found: 80, added: 2 },
    { name: 'hacker-news', label: 'Hacker News “Show HN” launches', everyMinutes: 60, lastRunAt: '2026-11-13T09:00:00Z', lastResult: 'error', found: 0, added: 0, lastError: 'hn.algolia.com answered 503' },
  ],
};
const candidates = [
  {
    domain: 'newco.ai', status: 'classified', sources: [{ source: 'hacker-news', title: 'Newco – an AI notetaker', url: 'https://news.ycombinator.com/item?id=1', at: '2026-11-13T09:00:00Z' }],
    firstSeenAt: '2026-11-13T09:00:00Z', lastSeenAt: '2026-11-13T09:00:00Z',
    suggestion: { isAiService: true, confidence: 0.92, name: 'Newco Notes', vendor: 'Newco Inc', category: 'work_app', businessTerms: 'unknown', domains: ['app.newco.ai'], summary: 'Records meetings and sends transcripts to its AI.', model: 'anthropic.claude-opus-5-5', at: '2026-11-13T09:01:00Z' },
  },
  { domain: 'slowsite.io', status: 'new', sources: [{ source: 'manual', title: 'Suggested by pa', at: '2026-11-13T08:00:00Z' }], firstSeenAt: '2026-11-13T08:00:00Z', lastSeenAt: '2026-11-13T08:00:00Z', classifyError: 'Couldn’t read slowsite.io: answered 403' },
];
const approveCandidate = vi.fn(async (..._a: unknown[]) => ({}));
const publishCatalog = vi.fn(async () => ({ version: 'x', services: 45 }));
vi.mock('../lib/catalog-review-api', () => ({
  fetchCatalogReview: vi.fn(async () => review),
  fetchCandidates: vi.fn(async () => candidates),
  approveCandidate: (...a: unknown[]) => approveCandidate(...a),
  publishCatalog: () => publishCatalog(),
  suggestDomain: vi.fn(), classifyCandidate: vi.fn(), rejectCandidate: vi.fn(), restoreCandidate: vi.fn(),
  removeService: vi.fn(), addAdvisory: vi.fn(), removeAdvisory: vi.fn(), discoverNow: vi.fn(),
}));
import { CatalogReviewPage } from '../pages/CatalogReviewPage';

const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CatalogReviewPage /></QueryClientProvider>);

describe('AI catalog review page', () => {
  it('leads with what’s waiting, shows what installs use and how each source is doing', async () => {
    renderPage();
    expect(await screen.findByText('2 possible AI services to review.')).toBeInTheDocument();
    expect(screen.getByText(/Installs use catalog 2026-11-13.093015: 44 services/)).toBeInTheDocument();
    expect(screen.getByText('1 new not published')).toBeInTheDocument();
    expect(screen.getByText(/Failed .*hn.algolia.com answered 503/)).toBeInTheDocument();
    expect(screen.getByText(/80 found, 2 new/)).toBeInTheDocument();
  });

  it('shows the classifier’s suggestion and approves it as a new service, prefilled', async () => {
    renderPage();
    const card = await screen.findByRole('article', { name: 'newco.ai' });
    expect(within(card).getByText(/AI · AI in a work app · 92%/)).toBeInTheDocument();
    expect(within(card).getByText('Records meetings and sends transcripts to its AI.')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Approve…' }));
    expect(within(card).getByLabelText('Name')).toHaveValue('Newco Notes');
    expect(within(card).getByLabelText('Id')).toHaveValue('newco-notes');
    expect(within(card).getByLabelText('Domains (comma separated)')).toHaveValue('app.newco.ai');
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approveCandidate).toHaveBeenCalledWith('newco.ai', { service: expect.objectContaining({ id: 'newco-notes', category: 'work_app', domains: ['app.newco.ai'] }) }));
  });

  it('says why a candidate couldn’t be classified, and publishes', async () => {
    renderPage();
    expect(await screen.findByText(/Couldn’t classify: Couldn’t read slowsite.io: answered 403/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishCatalog).toHaveBeenCalled());
  });
});
