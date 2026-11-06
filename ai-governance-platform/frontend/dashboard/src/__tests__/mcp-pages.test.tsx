import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { Approval, Connector, McpServerDetail, McpServerSummary, SignIn } from '../lib/mcp-api';

const summary: McpServerSummary = {
  serverId: 'hr-self-service', name: 'HR self-service', description: 'People lookups', status: 'published', hasChanges: true,
  path: '/mcp/tenant_demo/hr-self-service', tools: 2, week: { calls: 41, stopped: 3 }, updatedAt: '2026-11-05T10:00:00Z',
};
let detail: McpServerDetail;
const baseDetail: McpServerDetail = {
  serverId: 'hr-self-service', name: 'HR self-service', description: 'People lookups', status: 'draft', path: '/mcp/tenant_demo/hr-self-service',
  updatedAt: '2026-11-05T10:00:00Z', access: { allKeys: true, keyIds: [], people: 'none', groups: [] }, limits: { callsPerMinute: 60, maxResultBytes: 100000 },
  approvals: { approvers: [], waitSeconds: 45, expiresMinutes: 1440 },
  apis: [{ apiId: 'api_1', name: 'People API', baseUrl: 'https://people.acme.example', auth: { type: 'bearer', hint: '…-123' }, openapi: { title: 'People API', version: '1.2', operations: 2, skipped: [] } }],
  tools: [
    { name: 'getEmployee', apiId: 'api_1', title: 'One employee', description: '', method: 'GET', path: '/employees/{id}', write: false, enabled: true, inputSchema: { properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'createEmployee', apiId: 'api_1', title: 'Create employee', description: '', method: 'POST', path: '/employees', write: true, enabled: true, approval: 'required', inputSchema: {} },
  ],
};
const approval: Approval = {
  approvalId: 'fp-1', serverId: 'hr-self-service', serverName: 'HR self-service', tool: 'createEmployee', toolTitle: 'Create employee', method: 'POST', path: '/employees',
  apiName: 'People API', arguments: '{"body":{"name":"Sam"}}', caller: { kind: 'person', id: 'person:u1', label: 'jane@acme.example' }, status: 'pending',
  createdAt: '2026-11-05T10:00:00Z', expiresAt: '2026-11-06T10:00:00Z', canDecide: true,
};
const connector: Connector = { connectorId: 'con_1', name: 'HQ', allowedHosts: ['hr.corp.example'], tokenHint: '…abcd', createdAt: '2026-11-05T10:00:00Z', online: true, apis: 1, lastSeenAt: '2026-11-05T10:00:00Z' };
let signIn: SignIn = { configured: false, callbackUrl: 'https://gw.acme.example/oauth/callback' };

const createServer = vi.fn(async (..._a: unknown[]) => ({ ...detail, serverId: 'finance' }));
const publishServer = vi.fn(async (..._a: unknown[]) => ({}));
const changeTool = vi.fn(async (..._a: unknown[]) => ({}));
const changeServer = vi.fn(async (..._a: unknown[]) => ({}));
const decideApproval = vi.fn(async (..._a: unknown[]) => ({}));
const createConnector = vi.fn(async (..._a: unknown[]) => ({ ...connector, connectorId: 'con_2', name: 'Frankfurt', token: 'pcn_tenant_demo.con_2.secret' }));
const saveSignIn = vi.fn(async (..._a: unknown[]) => ({ ...signIn, configured: true }));
const testTool = vi.fn(async (..._a: unknown[]) => ({ requestId: 'req-9', isError: false, outcome: 'delivered', checks: ['arguments: valid', 'rules: passed', 'personal data: removed'], text: '{"name":"Jane","email":"[EMAIL]"}' }));
vi.mock('../lib/mcp-api', async (orig) => ({
  ...(await orig<typeof import('../lib/mcp-api')>()),
  listServers: vi.fn(async () => [summary]),
  getServer: vi.fn(async () => detail),
  listVersions: vi.fn(async () => [{ version: 1, note: 'First', publishedAt: '2026-11-05T10:00:00Z', publishedBy: 'admin', tools: 2, apis: 1, live: true }]),
  listApprovals: vi.fn(async () => [approval, { ...approval, approvalId: 'fp-2', status: 'refused', decidedBy: 'cfo@acme.example', reason: 'No', canDecide: false }]),
  listConnectors: vi.fn(async () => [connector]),
  getSignIn: vi.fn(async () => signIn),
  createServer: (...a: unknown[]) => createServer(...a),
  publishServer: (...a: unknown[]) => publishServer(...a),
  changeTool: (...a: unknown[]) => changeTool(...a),
  changeServer: (...a: unknown[]) => changeServer(...a),
  decideApproval: (...a: unknown[]) => decideApproval(...a),
  createConnector: (...a: unknown[]) => createConnector(...a),
  saveSignIn: (...a: unknown[]) => saveSignIn(...a),
  testTool: (...a: unknown[]) => testTool(...a),
  serverUrl: (p: string) => `https://gateway.acme.example${p}`,
}));
vi.mock('../lib/api-keys-api', async (orig) => ({ ...(await orig<typeof import('../lib/api-keys-api')>()), listKeys: vi.fn(async () => []) }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { tenantId: 'tenant_demo' }, isAdmin: true }) }));

import { McpServersPage } from '../pages/McpServersPage';
import { McpServerPage } from '../pages/McpServerPage';
import { McpApprovalsPage } from '../pages/McpApprovalsPage';
import { McpConnectorsPage } from '../pages/McpConnectorsPage';
import { McpSignInPage } from '../pages/McpSignInPage';

const renderAt = (path: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/mcp" element={<McpServersPage />} />
        <Route path="/mcp/approvals" element={<McpApprovalsPage />} />
        <Route path="/mcp/connectors" element={<McpConnectorsPage />} />
        <Route path="/mcp/sign-in" element={<McpSignInPage />} />
        <Route path="/mcp/:serverId" element={<McpServerPage />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>
);

describe('MCP servers', () => {
  beforeEach(() => { vi.clearAllMocks(); detail = structuredClone(baseDetail); signIn = { configured: false, callbackUrl: 'https://gw.acme.example/oauth/callback' }; });

  it('lists servers with status, changes waiting and this week’s calls, and shows how many approvals wait', async () => {
    renderAt('/mcp');
    const card = (await screen.findByRole('heading', { name: 'HR self-service' })).closest('article')!;
    expect(within(card).getByText('Live')).toBeInTheDocument();
    expect(within(card).getByText('Unpublished changes')).toBeInTheDocument();
    expect(within(card).getByText('41')).toBeInTheDocument();
    expect(await screen.findByLabelText('1 waiting')).toBeInTheDocument();
  });

  it('creates a server and opens it', async () => {
    renderAt('/mcp');
    fireEvent.click(await screen.findByRole('button', { name: 'Create MCP server' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. HR self-service'), { target: { value: 'Finance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createServer).toHaveBeenCalled());
    expect(createServer.mock.calls[0][0]).toEqual({ name: 'Finance', description: '' });
  });

  it('shows the address and setup for people or keys, and write tools with their approval choice', async () => {
    renderAt('/mcp/hr-self-service');
    expect(await screen.findByText('https://gateway.acme.example/mcp/tenant_demo/hr-self-service')).toBeInTheDocument();
    expect(screen.getByText(/claude mcp add --transport http hr-self-service .*--header/s)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'People sign in' }));
    expect(await screen.findByText(/Sign-in isn’t set up yet/)).toBeInTheDocument();
    expect(screen.getByText(/run \/mcp in Claude Code/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'getEmployee: on' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'createEmployee: on' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Runs without approval' }));
    await waitFor(() => expect(changeTool).toHaveBeenCalledWith('hr-self-service', 'createEmployee', { approval: 'none' }));
    expect(screen.getByText(/bearer token …-123/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishServer).toHaveBeenCalled());
  });

  it('publishes changes with a note, lets admins choose people by group, and lists versions', async () => {
    detail = { ...structuredClone(baseDetail), status: 'published', publishedVersion: 1, hasChanges: true };
    renderAt('/mcp/hr-self-service');
    fireEvent.change(await screen.findByPlaceholderText('e.g. Added leave balances'), { target: { value: 'Writes on' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish changes' }));
    await waitFor(() => expect(publishServer).toHaveBeenCalledWith('hr-self-service', 'Writes on'));
    const access = screen.getByRole('region', { name: 'Access and limits' });
    fireEvent.click(within(access).getByRole('button', { name: 'Only these groups' }));
    fireEvent.change(within(access).getByLabelText('Groups'), { target: { value: 'HR, People partners' } });
    fireEvent.click(within(access).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeServer).toHaveBeenCalled());
    expect((changeServer.mock.calls[0][1] as any).access).toEqual({ allKeys: true, keyIds: [], people: 'groups', groups: ['HR', 'People partners'] });
    expect(await screen.findByText('Version 1')).toBeInTheDocument();
  });

  it('tries a tool with arguments from its schema and shows the checks', async () => {
    renderAt('/mcp/hr-self-service');
    const console = await screen.findByRole('region', { name: 'Try a tool' });
    expect((within(console).getByRole('textbox') as HTMLTextAreaElement).value).toBe('{\n  "id": ""\n}');
    fireEvent.change(within(console).getByRole('textbox'), { target: { value: '{"id":"e1"}' } });
    fireEvent.click(within(console).getByRole('button', { name: 'Run' }));
    expect(await within(console).findByText('Delivered')).toBeInTheDocument();
    expect(testTool).toHaveBeenCalledWith('hr-self-service', 'getEmployee', { id: 'e1' });
    expect(within(console).getByText('personal data: removed')).toBeInTheDocument();
  });

  it('shows what an agent wants to send, and approves or refuses with a reason', async () => {
    renderAt('/mcp/approvals');
    const req = await screen.findByRole('article', { name: 'Create employee on HR self-service' });
    expect(within(req).getByText('jane@acme.example wants to run Create employee')).toBeInTheDocument();
    expect(within(req).getByText(/"name": "Sam"/)).toBeInTheDocument();
    fireEvent.change(within(req).getByRole('textbox'), { target: { value: 'Duplicate' } });
    fireEvent.click(within(req).getByRole('button', { name: 'Refuse' }));
    await waitFor(() => expect(decideApproval).toHaveBeenCalledWith('fp-1', 'refuse', 'Duplicate'));
    expect(screen.getByText(/Refused by cfo@acme.example · “No”/)).toBeInTheDocument();
  });

  it('creates a connector and shows its token once, with the command to run it', async () => {
    renderAt('/mcp/connectors');
    expect(await screen.findByText('Online')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a connector' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Frankfurt data centre'), { target: { value: 'Frankfurt' } });
    fireEvent.change(screen.getByRole('region', { name: 'New connector' }).querySelector('textarea')!, { target: { value: 'hr.corp.example\n*.svc.corp.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createConnector).toHaveBeenCalledWith({ name: 'Frankfurt', allowedHosts: ['hr.corp.example', '*.svc.corp.example'] }));
    expect(await screen.findByText(/PROBALINE_CONNECTOR_TOKEN=pcn_tenant_demo.con_2.secret/)).toBeInTheDocument();
  });

  it('sets up sign-in with the redirect address to register', async () => {
    renderAt('/mcp/sign-in');
    expect(await screen.findByText('https://gw.acme.example/oauth/callback')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('https://login.microsoftonline.com/<tenant>/v2.0'), { target: { value: 'https://login.acme.example' } });
    const form = screen.getByRole('region', { name: 'Identity provider' });
    const inputs = form.querySelectorAll('input');
    fireEvent.change(inputs[1], { target: { value: 'client-1' } });
    fireEvent.change(inputs[2], { target: { value: 's3cret' } });
    fireEvent.change(inputs[4], { target: { value: 'offline_access groups' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveSignIn).toHaveBeenCalledWith({ issuer: 'https://login.acme.example', clientId: 'client-1', clientSecret: 's3cret', groupsClaim: 'groups', extraScopes: ['offline_access', 'groups'], sessionHours: 8 }));
  });
});
