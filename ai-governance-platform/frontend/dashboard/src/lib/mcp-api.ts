import { createApiClient } from './http';

const gateway = createApiClient('/api');

export type ServerStatus = 'draft' | 'published' | 'paused';

export interface McpServerSummary {
  serverId: string;
  name: string;
  description: string;
  status: ServerStatus;
  path: string;
  tools: number;
  week: { calls: number; stopped: number };
  updatedAt: string;
}

export interface McpTool {
  name: string;
  apiId: string;
  title: string;
  description: string;
  method: string;
  path: string;
  write: boolean;
  enabled: boolean;
  inputSchema: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
}

export interface McpApi {
  apiId: string;
  name: string;
  baseUrl: string;
  auth: { type: 'none' | 'bearer' | 'header'; header?: string; hint?: string };
  openapi: { title: string; version: string; operations: number; skipped: string[] };
}

export interface McpServerDetail extends Omit<McpServerSummary, 'tools' | 'week'> {
  access: { allKeys: boolean; keyIds: string[] };
  limits: { callsPerMinute: number; maxResultBytes: number };
  returnPersonalData?: boolean;
  apis: McpApi[];
  tools: McpTool[];
}

export interface TestResult { requestId: string; isError: boolean; text: string; outcome: string; checks: string[] }

export type ApiAuthInput = { type: 'none' } | { type: 'bearer'; secret: string } | { type: 'header'; header: string; secret: string };

export const listServers = async () => (await gateway.get<McpServerSummary[]>('/v1/mcp/servers')).data;
export const createServer = async (input: { name: string; description: string }) => (await gateway.post<McpServerDetail>('/v1/mcp/servers', input)).data;
export const getServer = async (id: string) => (await gateway.get<McpServerDetail>(`/v1/mcp/servers/${encodeURIComponent(id)}`)).data;
export const changeServer = async (id: string, change: Partial<Pick<McpServerDetail, 'name' | 'description' | 'access' | 'limits' | 'returnPersonalData'>>) =>
  (await gateway.patch(`/v1/mcp/servers/${encodeURIComponent(id)}`, change)).data;
export const publishServer = async (id: string) => (await gateway.post(`/v1/mcp/servers/${encodeURIComponent(id)}/publish`, {})).data;
export const pauseServer = async (id: string) => (await gateway.post(`/v1/mcp/servers/${encodeURIComponent(id)}/pause`, {})).data;
export const deleteServer = async (id: string) => (await gateway.delete(`/v1/mcp/servers/${encodeURIComponent(id)}`)).data;
export const addApi = async (id: string, input: { name: string; baseUrl: string; openapi: string; auth: ApiAuthInput }) =>
  (await gateway.post<{ tools: number; reads: number; skipped: string[] }>(`/v1/mcp/servers/${encodeURIComponent(id)}/apis`, input)).data;
export const removeApi = async (id: string, apiId: string) => (await gateway.delete(`/v1/mcp/servers/${encodeURIComponent(id)}/apis/${encodeURIComponent(apiId)}`)).data;
export const changeTool = async (id: string, name: string, change: { enabled?: boolean }) =>
  (await gateway.patch(`/v1/mcp/servers/${encodeURIComponent(id)}/tools/${encodeURIComponent(name)}`, change)).data;
export const testTool = async (id: string, tool: string, args: Record<string, unknown>) =>
  (await gateway.post<TestResult>(`/v1/mcp/servers/${encodeURIComponent(id)}/test`, { tool, arguments: args })).data;

/** The full address agents use. In the dashboard the gateway sits behind /api; elsewhere it's its own host. */
export function serverUrl(path: string): string {
  const base = (import.meta.env.VITE_GATEWAY_PUBLIC_URL as string | undefined) || `${window.location.origin}/api`;
  return `${base.replace(/\/$/, '')}${path}`;
}
