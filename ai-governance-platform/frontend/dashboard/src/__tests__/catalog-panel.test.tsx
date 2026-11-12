import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

const state = {
  sequence: 1, version: '2026-11-12.1430', publishedAt: '2026-11-12T14:30:00Z', source: 'feed', services: 61,
  advisories: [{ id: 'a1', serviceId: 'x', severity: 'warning', title: 'Newco now trains on prompts', detail: 'Its terms changed on 10 Nov.', publishedAt: '2026-11-10T00:00:00Z' }],
  updates: 'auto', url: 'https://probaline.com/catalog/v1/latest.json',
  lastCheckedAt: '2026-11-12T15:00:00Z', lastResult: 'error', lastError: 'That catalog wasn’t signed by a key this install trusts.',
};
const checkCatalog = vi.fn(async () => ({ result: 'unchanged', message: 'The catalog hasn’t changed since the last check.', catalog: { ...state, lastResult: 'unchanged', lastError: undefined } }));
const uploadCatalog = vi.fn(async (_d: string) => ({ result: 'updated', message: 'Now using catalog 2026-11-13.0900 (70 services).', catalog: { ...state, version: '2026-11-13.0900', services: 70, source: 'upload' } }));
vi.mock('../lib/catalog-api', () => ({
  fetchCatalog: vi.fn(async () => state),
  checkCatalog: () => checkCatalog(),
  uploadCatalog: (d: string) => uploadCatalog(d),
}));
import { CatalogPanel } from '../components/CatalogPanel';

const renderPanel = (canManage: boolean) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CatalogPanel canManage={canManage} /></QueryClientProvider>,
);

describe('AI service catalog panel', () => {
  it('shows the catalog in use, where updates come from, the last problem and advisories', async () => {
    renderPanel(false);
    expect(await screen.findByText(/Catalog 2026-11-12.1430 · 61 services · downloaded from Probaline/)).toBeInTheDocument();
    expect(screen.getByText('https://probaline.com/catalog/v1/latest.json')).toBeInTheDocument();
    expect(screen.getByText(/nothing about this install is sent/)).toBeInTheDocument();
    expect(screen.getByText(/key this install trusts/)).toBeInTheDocument();
    expect(screen.getByText('Newco now trains on prompts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
  });

  it('lets an admin check now and upload a catalog file', async () => {
    renderPanel(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByRole('status')).toHaveTextContent('hasn’t changed');
    const file = new File(['{"format":"probaline.catalog/1"}'], 'latest.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Catalog file'), { target: { files: [file] } });
    await waitFor(() => expect(uploadCatalog).toHaveBeenCalledWith('{"format":"probaline.catalog/1"}'));
    expect(await screen.findByText(/Catalog 2026-11-13.0900 · 70 services · uploaded from a file/)).toBeInTheDocument();
  });
});
