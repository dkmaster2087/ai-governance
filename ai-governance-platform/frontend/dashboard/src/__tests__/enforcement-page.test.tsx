import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

const GW = 'arn:aws:iam::111122223333:role/probaline-gateway-task';
const data = {
  catalogVersion: '2026-11-07',
  egressIps: ['203.0.113.4'],
  categories: [
    { id: 'model_api', label: 'Model APIs', hint: 'APIs apps call.' },
    { id: 'chat', label: 'Chat apps', hint: 'In a browser.' },
  ],
  defaultCategories: ['model_api', 'chat'],
  formats: [
    { id: 'domains', label: 'Domain list', products: 'Palo Alto Networks EDL', rule: 'Block it except from 203.0.113.4.' },
    { id: 'zscaler', label: 'Zscaler', products: 'ZIA', rule: 'Zscaler rule.' },
    { id: 'netskope', label: 'Netskope', products: 'URL list', rule: 'Netskope rule.' },
    { id: 'rpz', label: 'DNS RPZ', products: 'BIND', rule: 'RPZ rule.' },
    { id: 'hosts', label: 'Hosts file', products: 'Labs', rule: 'Hosts rule.' },
  ],
  feeds: [{ feedId: 'fd1', name: 'Palo Alto', categories: ['chat'], tokenHint: 'Xy9z', domains: 21, createdAt: 'x', updatedAt: 'x', lastFetchedAt: '2026-11-08T09:00:00Z', lastFetchedFrom: '198.51.100.20', lastFetchedAgent: 'PAN-OS', fetchCount: 14 }],
  maxFeeds: 10,
  approvedTools: ['claude'],
  aws: { gatewayRoleArn: GW },
};
const urls = Object.fromEntries(['domains', 'zscaler', 'netskope', 'rpz', 'hosts'].map((f) => [f, `https://gw.example/public/feeds/t/fd2.secret/${f}`]));
const createFeed = vi.fn(async (..._a: unknown[]) => ({ feedId: 'fd2', urls, feed: data.feeds[0] }));
const previewFeed = vi.fn(async (..._a: unknown[]) => ({ domains: 30, sample: ['api.openai.com', 'chatgpt.com'], findingsTo: '2026-11-07', wouldBeBlocked: { services: [{ id: 'chatgpt', name: 'ChatGPT', people: 12, machines: 0, count: 300 }], apps: [{ who: 'host:app-1', services: ['OpenAI API'], count: 900 }] } }));
const generateAws = vi.fn(async (..._a: unknown[]) => ({
  serviceControlPolicy: { Version: '2012-10-17', Statement: [{ Effect: 'Deny' }] }, vpcEndpointPolicy: {}, cloudFormation: {},
  problems: [], notes: ['Attach to one OU first.'],
  wouldBeBlocked: [{ who: 'role:claims-bot', services: ['Amazon Bedrock'], count: 40, identityKnown: true }, { who: 'ip:10.0.0.5', services: ['Amazon Bedrock'], count: 6, identityKnown: false }],
}));
vi.mock('../lib/enforcement-api', async (orig) => ({
  ...(await orig<typeof import('../lib/enforcement-api')>()),
  getEnforcement: vi.fn(async () => data),
  createFeed: (...a: unknown[]) => createFeed(...a),
  previewFeed: (...a: unknown[]) => previewFeed(...a),
  generateAws: (...a: unknown[]) => generateAws(...a),
  saveAws: vi.fn(async () => undefined),
  rotateFeed: vi.fn(), revokeFeed: vi.fn(), updateFeed: vi.fn(), feedContent: vi.fn(async () => 'chatgpt.com\n'),
}));
import { EnforcementPage } from '../pages/EnforcementPage';
import { slimFindings } from '../lib/enforcement-api';

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><EnforcementPage /></MemoryRouter></QueryClientProvider>
);

const FINDINGS = { to: '2026-11-07', catalogVersion: '2026-11-07', services: [{ id: 'chatgpt', name: 'ChatGPT', category: 'chat', people: 12, machines: 0, count: 300, vendor: 'OpenAI' }], paths: [{ id: 'cloud_ai', share: 0.5, stillDirect: [{ who: 'role:claims-bot', services: ['Amazon Bedrock'], count: 40, sources: ['x'], fix: 'y' }] }], sources: [{ label: 'big' }] };

describe('Enforcement page', () => {
  it('shows each feed with when and by whom it was last fetched, and the gateway’s addresses', async () => {
    renderPage();
    expect(await screen.findByText('Palo Alto')).toBeInTheDocument();
    expect(screen.getByText(/by 198\.51\.100\.20 \(PAN-OS\) · 14 fetches/)).toBeInTheDocument();
    expect(screen.getByText(/Chat apps · 21 domains · address ends …Xy9z/)).toBeInTheDocument();
    expect(screen.getByText('203.0.113.4')).toBeInTheDocument();
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(1);
  });

  it('previews a new feed from a findings file, creates it and shows the addresses once', async () => {
    renderPage();
    const file = new File([JSON.stringify(FINDINGS)], 'findings-2026-11-07.json', { type: 'application/json' });
    fireEvent.change(await screen.findByLabelText('Findings file'), { target: { files: [file] } });
    expect(await screen.findByText(/Using findings up to/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New feed' }));
    expect(await screen.findByText(/ChatGPT \(12 users or devices\)/)).toBeInTheDocument();
    expect(screen.getByText('host:app-1')).toBeInTheDocument();
    // Only the fields previews need go to the gateway.
    const sent = previewFeed.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('sources');
    expect(JSON.stringify(sent)).not.toContain('fix');
    fireEvent.click(screen.getByRole('button', { name: 'Create feed' }));
    expect(await screen.findByText('Copy the feed address now. It won’t be shown again.')).toBeInTheDocument();
    expect(screen.getByText(urls.domains)).toBeInTheDocument();
    expect(screen.getByText('Block it except from 203.0.113.4.')).toBeInTheDocument();
    expect(createFeed).toHaveBeenCalledWith({ name: 'Firewalls', categories: ['model_api', 'chat'] });
  });

  it('writes the AWS policies and lists who they would refuse', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Write the policies' }));
    expect(await screen.findByText('role:claims-bot')).toBeInTheDocument();
    expect(screen.getByText(/Seen by address only/)).toBeInTheDocument();
    expect(screen.getByText('Attach to one OU first.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(3);
    await waitFor(() => expect(generateAws).toHaveBeenCalledWith(expect.objectContaining({ gatewayRoleArn: GW, sagemaker: true }), undefined));
  });

  it('refuses files that aren’t findings', () => {
    expect(() => slimFindings({ hello: 1 })).toThrow(/findings file/);
    expect(() => slimFindings([])).toThrow();
  });
});
