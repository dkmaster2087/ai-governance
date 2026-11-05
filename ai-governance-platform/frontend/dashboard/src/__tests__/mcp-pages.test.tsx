import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { McpServerDetail, McpServerSummary } from '../lib/mcp-api';

const summary: McpServerSummary = {
  serverId: 'hr-self-service', name: 'HR self-service', description: 'People lookups', status: 'published',
  path: '/mcp/tenant_demo/hr-self-service', tools: 2, week: { calls: 41, stopped: 3 }, updatedAt: '2026-11-05T10:00:00Z',
};
const detail: McpServerDetail = {
  serverId: 'hr-self-service', name: 'HR self-service', description: 'People lookups', status: 'draft', path: '/mcp/tenant_demo/hr-self-service',
  updatedAt: '2026-11-05T10:00:00Z', access: { allKeys: true, keyIds: [] }, limits: { callsPerMinute: 60, maxResultBytes: 100000 },
  apis: [{ apiId: 'api_1', name: 'People API', baseUrl: 'https://people.acme.example', auth: { type: 'bearer', hint: '…-123' }, openapi: { title: 'People API', version: '1.2', operations: 2, skipped: [] } }],
  tools: [
    { name: 'getEmployee', apiId: 'api_1', title: 'One employee', description: '', method: 'GET', path: '/employees/{id}', write: false, enabled: true, inputSchema: { properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'createEmployee', apiId: 'api_1', title: 'Create employee', description: '', method: 'POST', path: '/employees', write: true, enabled: false, inputSchema: {} },
  ],
};

const createServer = vi.fn(async (..._a: unknown[]) => ({ ...detail, serverId: 'finance' }));
const publishServer = vi.fn(async (..._a: unknown[]) => ({}));
const testTool = vi.fn(async (..._a: unknown[]) => ({ requestId: 'req-9', isError: false, outcome: 'delivered', checks: ['arguments: valid', 'rules: passed', 'personal data: removed'], text: '{"name":"Jane","email":"[EMAIL]"}' }));
vi.mock('../lib/mcp-api', async (orig) => ({
  ...(await orig<typeof import('../lib/mcp-api')>()),
  listServers: vi.fn(async () => [summary]),
  getServer: vi.fn(async () => detail),
  createServer: (...a: unknown[]) => createServer(...a),
  publishServer: (...a: unknown[]) => publishServer(...a),
  testTool: (...a: unknown[]) => testTool(...a),
  serverUrl: (p: string) => `https://gateway.acme.example${p}`,
}));
vi.mock('../lib/api-keys-api', async (orig) => ({ ...(await orig<typeof import('../lib/api-keys-api')>()), listKeys: vi.fn(async () => []) }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { tenantId: 'tenant_demo' }, isAdmin: true }) }));

import { McpServersPage } from '../pages/McpServersPage';
import { McpServerPage } from '../pages/McpServerPage';

const renderAt = (path: string) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/mcp" element={<McpServersPage />} />
        <Route path="/mcp/:serverId" element={<McpServerPage />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>
);

describe('MCP servers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists servers with status and this week’s calls', async () => {
    renderAt('/mcp');
    const card = (await screen.findByRole('heading', { name: 'HR self-service' })).closest('article')!;
    expect(within(card).getByText('Live')).toBeInTheDocument();
    expect(within(card).getByText('41')).toBeInTheDocument();
    expect(within(card).getByText('/mcp/tenant_demo/hr-self-service')).toBeInTheDocument();
  });

  it('creates a server and opens it', async () => {
    renderAt('/mcp');
    fireEvent.click(await screen.findByRole('button', { name: 'Create MCP server' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. HR self-service'), { target: { value: 'Finance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createServer).toHaveBeenCalled());
    expect(createServer.mock.calls[0][0]).toEqual({ name: 'Finance', description: '' });
  });

  it('shows the address, setup for agents, and tools with writes not yet available', async () => {
    renderAt('/mcp/hr-self-service');
    expect(await screen.findByText('https://gateway.acme.example/mcp/tenant_demo/hr-self-service')).toBeInTheDocument();
    expect(screen.getByText(/claude mcp add --transport http hr-self-service/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'getEmployee: on' })).toBeInTheDocument();
    expect(screen.getByText('Changes data · comes next')).toBeInTheDocument();
    expect(screen.getByText(/bearer token …-123/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishServer).toHaveBeenCalled());
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
});
