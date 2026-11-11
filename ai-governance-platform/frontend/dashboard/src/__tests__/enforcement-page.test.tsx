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
  paths: [
    { id: 'out_model_api', direction: 'out', title: 'Apps calling model APIs over the internet', lock: 'AI-domain feed', anchor: 'feed', state: 'locked', stateUpdatedAt: '2026-11-01T00:00:00Z',
      measured: { to: '2026-11-07', share: 0.6, through: 60, direct: 40, gatewaySeen: true, measuredBy: 'AWS Route 53 Resolver DNS query logs', stillDirectCount: 5, stillDirect: [{ who: 'host:app-1', services: ['OpenAI API'], count: 30 }, { who: 'host:app-2', services: ['OpenAI API'], count: 5 }, { who: 'host:app-3', services: ['OpenAI API'], count: 2 }] },
      trend: [{ to: '2026-10-24', share: 0.4 }, { to: '2026-11-07', share: 0.6 }],
      warning: 'Marked locked, but 5 callers still go direct in findings to 2026-11-07. The lock may not be applied everywhere.' },
    { id: 'out_cloud_ai', direction: 'out', title: 'Apps in AWS calling Bedrock or SageMaker', lock: 'Service control policy', anchor: 'aws', state: 'open', trend: [] },
    { id: 'out_browser', direction: 'out', title: 'People using AI tools in a browser', lock: 'Browser extension', state: 'open', trend: [], measuredElsewhere: 'Measured by the browser extension on the Shadow AI page.' },
    { id: 'in_agents', direction: 'in', title: 'Agents calling your APIs directly', lock: 'Signed calls', anchor: 'apis', state: 'open', trend: [], measuredElsewhere: 'Measured from your APIs’ access logs: coming next.' },
    { id: 'in_laptop_mcp', direction: 'in', title: 'MCP servers on laptops using people’s own credentials', lock: 'Scan', anchor: 'laptops', state: 'open', trend: [],
      laptops: { to: '2026-11-07', scannedDevices: 40, devicesWithServers: 6, people: 5, servers: [{ what: 'hr.acme.example', kind: 'remote', devices: 3, people: 3, withCredentials: 1, company: true, clients: ['cursor'] }] } },
  ],
  findings: [{ findingsId: 'fi1', from: '2026-10-08', to: '2026-11-07', catalogVersion: '2026-11-07', uploadedAt: '2026-11-08T09:00:00Z', fileName: 'findings-2026-11-07.json', services: 13 }],
};
const urls = Object.fromEntries(['domains', 'zscaler', 'netskope', 'rpz', 'hosts'].map((f) => [f, `https://gw.example/public/feeds/t/fd2.secret/${f}`]));
const createFeed = vi.fn(async (..._a: unknown[]) => ({ feedId: 'fd2', urls, feed: data.feeds[0] }));
const previewFeed = vi.fn(async (..._a: unknown[]) => ({ domains: 30, sample: ['api.openai.com', 'chatgpt.com'], findingsTo: '2026-11-07', wouldBeBlocked: { services: [{ id: 'chatgpt', name: 'ChatGPT', people: 12, machines: 0, count: 300 }], apps: [{ who: 'host:app-1', services: ['OpenAI API'], count: 900 }] } }));
const generateAws = vi.fn(async (..._a: unknown[]) => ({
  serviceControlPolicy: { Version: '2012-10-17', Statement: [{ Effect: 'Deny' }] }, vpcEndpointPolicy: {}, cloudFormation: {},
  problems: [], notes: ['Attach to one OU first.'],
  wouldBeBlocked: [{ who: 'role:claims-bot', services: ['Amazon Bedrock'], count: 40, identityKnown: true }, { who: 'ip:10.0.0.5', services: ['Amazon Bedrock'], count: 6, identityKnown: false }],
}));
const setPathState = vi.fn(async (..._a: unknown[]) => ({ path: data.paths[1] }));
const uploadFindings = vi.fn(async (..._a: unknown[]) => ({ findingsId: 'fi2' }));
vi.mock('../lib/enforcement-api', async (orig) => ({
  ...(await orig<typeof import('../lib/enforcement-api')>()),
  getEnforcement: vi.fn(async () => data),
  createFeed: (...a: unknown[]) => createFeed(...a),
  previewFeed: (...a: unknown[]) => previewFeed(...a),
  generateAws: (...a: unknown[]) => generateAws(...a),
  saveAws: vi.fn(async () => undefined),
  setPathState: (...a: unknown[]) => setPathState(...a),
  getLockKitApis: vi.fn(async () => ({
    issuer: 'https://gateway.acme.example', jwksUrl: 'https://gateway.acme.example/.well-known/jwks.json', header: 'X-Probaline-Identity', tokenLifetimeSeconds: 300, egressIps: ['203.0.113.4'],
    apis: [
      { apiId: 'a1', name: 'People API', serverId: 's1', serverName: 'HR tools', audience: 'https://hr.acme.example/api' },
      { apiId: 'a2', name: 'Payroll', serverId: 's1', serverName: 'HR tools', audience: 'http://payroll.corp:8080', connector: 'Datacenter' },
    ],
  })),
  uploadFindings: (...a: unknown[]) => uploadFindings(...a),
  deleteFindings: vi.fn(async () => undefined),
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

  it('shows each path: state, measured share, trend, who is still direct, and a warning when they disagree', async () => {
    renderPage();
    const row = await screen.findByRole('article', { name: 'Apps calling model APIs over the internet' });
    expect(row).toHaveTextContent('60%');
    expect(row).toHaveTextContent('60 of 100 in AWS Route 53 Resolver DNS query logs');
    expect(row).toHaveTextContent(/Trend: .*40% → .*60%/);
    expect(row).toHaveTextContent('Still direct: host:app-1, host:app-2, host:app-3 and 2 more.');
    expect(row).toHaveTextContent('Marked locked, but 5 callers still go direct');
    expect(screen.getByRole('article', { name: 'Apps in AWS calling Bedrock or SageMaker' })).toHaveTextContent('Not measured yet');
    expect(screen.getByRole('article', { name: 'Agents calling your APIs directly' })).toHaveTextContent('access logs');
    const laptops = screen.getByRole('article', { name: 'MCP servers on laptops using people’s own credentials' });
    expect(laptops).toHaveTextContent('of 40 laptops with MCP servers set up by hand');
    expect(laptops).toHaveTextContent('hr.acme.example (company system)');
    fireEvent.click(screen.getByRole('group', { name: 'State of Apps in AWS calling Bedrock or SageMaker' }).querySelector('button:nth-child(2)')!);
    await waitFor(() => expect(setPathState).toHaveBeenCalledWith('out_cloud_ai', 'previewing'));
  });

  it('uploads a findings file trimmed to what the page uses, and previews a new feed from the stored findings', async () => {
    renderPage();
    const file = new File([JSON.stringify(FINDINGS)], 'findings-2026-11-07.json', { type: 'application/json' });
    fireEvent.change(await screen.findByLabelText('Findings file'), { target: { files: [file] } });
    await waitFor(() => expect(uploadFindings).toHaveBeenCalled());
    const [sent, name] = uploadFindings.mock.calls[0] as [Record<string, any>, string];
    expect(name).toBe('findings-2026-11-07.json');
    expect(sent).not.toHaveProperty('sources');
    expect(sent.paths[0]).toMatchObject({ id: 'cloud_ai', share: 0.5 });
    expect(screen.getByText(/13 services · catalog 2026-11-07/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New feed' }));
    expect(await screen.findByText(/ChatGPT \(12 users or devices\)/)).toBeInTheDocument();
    expect(screen.getByText('host:app-1', { selector: 'code' })).toBeInTheDocument();
    expect(previewFeed).toHaveBeenCalledWith(['model_api', 'chat']);
    fireEvent.click(screen.getByRole('button', { name: 'Create feed' }));
    expect(await screen.findByText('Copy the feed address now. It won’t be shown again.')).toBeInTheDocument();
    expect(screen.getByText(urls.domains)).toBeInTheDocument();
    expect(createFeed).toHaveBeenCalledWith({ name: 'Firewalls', categories: ['model_api', 'chat'] });
  });

  it('writes the AWS policies and lists who they would refuse', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Write the policies' }));
    expect(await screen.findByText('role:claims-bot')).toBeInTheDocument();
    expect(screen.getByText(/Seen by address only/)).toBeInTheDocument();
    expect(screen.getByText('Attach to one OU first.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(3);
    await waitFor(() => expect(generateAws).toHaveBeenCalledWith(expect.objectContaining({ gatewayRoleArn: GW, sagemaker: true })));
  });

  it('refuses files that aren’t findings', () => {
    expect(() => slimFindings({ hello: 1 })).toThrow(/findings file/);
    expect(() => slimFindings([])).toThrow();
  });

  it('fills the API lock kit with this gateway and API, report-only first, and marks untested languages', async () => {
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Lock your APIs' });
    await waitFor(() => expect(panel).toHaveTextContent('https://hr.acme.example/api'));
    const code = () => panel.querySelector('code.block')!.textContent!;
    expect(code()).toContain("issuer: \"https://gateway.acme.example\"");
    expect(code()).toContain('reportOnly: true');
    fireEvent.click(screen.getByRole('switch', { name: 'Report only' }));
    expect(code()).toContain('reportOnly: false');
    fireEvent.click(screen.getByRole('button', { name: 'Python' }));
    expect(code()).toContain('report_only=False');
    expect(panel).toHaveTextContent('tested against tokens the gateway signs');
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(panel).toHaveTextContent('Not yet tested');
    expect(screen.getByRole('button', { name: 'Download probaline_identity.go' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a2' } });
    expect(panel).toHaveTextContent('reached through the connector “Datacenter”');
    expect(screen.getByRole('button', { name: 'Download mcp-scan.sh' })).toBeInTheDocument();
  });
});
