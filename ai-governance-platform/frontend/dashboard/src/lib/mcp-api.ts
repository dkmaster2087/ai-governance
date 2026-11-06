import { createApiClient } from './http';

const gateway = createApiClient('/api');
const enc = encodeURIComponent;

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
  hasChanges?: boolean;
  publishedVersion?: number;
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
  approval?: 'required' | 'none';
  groups?: string[];
  inputSchema: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
}

export interface McpApi {
  apiId: string;
  name: string;
  baseUrl: string;
  connectorId?: string;
  auth: { type: 'none' | 'bearer' | 'header'; header?: string; hint?: string };
  openapi: { title: string; version: string; operations: number; skipped: string[] };
}

export interface ServerAccess { allKeys: boolean; keyIds: string[]; people: 'none' | 'all' | 'groups'; groups: string[] }
export interface ApprovalSettings { approvers: string[]; waitSeconds: number; expiresMinutes: number; webhookUrl?: string }

export interface McpServerDetail extends Omit<McpServerSummary, 'tools' | 'week'> {
  access: ServerAccess;
  limits: { callsPerMinute: number; maxResultBytes: number };
  returnPersonalData?: boolean;
  approvals: ApprovalSettings;
  apis: McpApi[];
  tools: McpTool[];
}

export interface McpVersion { version: number; note: string; publishedAt: string; publishedBy: string; tools: number; apis: number; live: boolean }

export interface TestResult { requestId: string; isError: boolean; text: string; outcome: string; checks: string[]; approvalId?: string }

export type ApiAuthInput = { type: 'none' } | { type: 'bearer'; secret: string } | { type: 'header'; header: string; secret: string };

export type ServerChange = Partial<Pick<McpServerDetail, 'name' | 'description' | 'access' | 'limits' | 'returnPersonalData' | 'approvals'>>;

export const listServers = async () => (await gateway.get<McpServerSummary[]>('/v1/mcp/servers')).data;
export const createServer = async (input: { name: string; description: string }) => (await gateway.post<McpServerDetail>('/v1/mcp/servers', input)).data;
export const getServer = async (id: string) => (await gateway.get<McpServerDetail>(`/v1/mcp/servers/${enc(id)}`)).data;
export const changeServer = async (id: string, change: ServerChange) => (await gateway.patch(`/v1/mcp/servers/${enc(id)}`, change)).data;
export const publishServer = async (id: string, note = '') => (await gateway.post(`/v1/mcp/servers/${enc(id)}/publish`, { note })).data;
export const pauseServer = async (id: string) => (await gateway.post(`/v1/mcp/servers/${enc(id)}/pause`, {})).data;
export const resumeServer = async (id: string) => (await gateway.post(`/v1/mcp/servers/${enc(id)}/resume`, {})).data;
export const deleteServer = async (id: string) => (await gateway.delete(`/v1/mcp/servers/${enc(id)}`)).data;
export const listVersions = async (id: string) => (await gateway.get<McpVersion[]>(`/v1/mcp/servers/${enc(id)}/versions`)).data;
export const restoreVersion = async (id: string, version: number) => (await gateway.post(`/v1/mcp/servers/${enc(id)}/versions/${version}/restore`, {})).data;
export const addApi = async (id: string, input: { name: string; baseUrl: string; openapi: string; auth: ApiAuthInput; connectorId?: string }) =>
  (await gateway.post<{ tools: number; reads: number; skipped: string[] }>(`/v1/mcp/servers/${enc(id)}/apis`, input)).data;
export const removeApi = async (id: string, apiId: string) => (await gateway.delete(`/v1/mcp/servers/${enc(id)}/apis/${enc(apiId)}`)).data;
export const changeTool = async (id: string, name: string, change: { enabled?: boolean; approval?: 'required' | 'none'; groups?: string[] }) =>
  (await gateway.patch(`/v1/mcp/servers/${enc(id)}/tools/${enc(name)}`, change)).data;
export const testTool = async (id: string, tool: string, args: Record<string, unknown>) =>
  (await gateway.post<TestResult>(`/v1/mcp/servers/${enc(id)}/test`, { tool, arguments: args })).data;

// ── Approvals ───────────────────────────────────────────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'refused' | 'expired' | 'used';
export interface Approval {
  approvalId: string;
  serverId: string;
  serverName: string;
  tool: string;
  toolTitle: string;
  method: string;
  path: string;
  apiName: string;
  arguments: string;
  caller: { kind: 'api_key' | 'person' | 'test'; id: string; label: string };
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  decidedBy?: string;
  decidedAt?: string;
  reason?: string;
  usedAt?: string;
  canDecide: boolean;
}
export const listApprovals = async () => (await gateway.get<Approval[]>('/v1/mcp/approvals')).data;
export const decideApproval = async (id: string, decision: 'approve' | 'refuse', reason?: string) =>
  (await gateway.post<Approval>(`/v1/mcp/approvals/${enc(id)}/${decision}`, reason ? { reason } : {})).data;

// ── Connectors ──────────────────────────────────────────────────────────────────────────────────

export interface Connector {
  connectorId: string;
  name: string;
  allowedHosts: string[];
  tokenHint: string;
  createdAt: string;
  lastSeenAt?: string;
  agentVersion?: string;
  online: boolean;
  apis: number;
}
export const listConnectors = async () => (await gateway.get<Connector[]>('/v1/mcp/connectors')).data;
export const createConnector = async (input: { name: string; allowedHosts: string[] }) => (await gateway.post<Connector & { token: string }>('/v1/mcp/connectors', input)).data;
export const changeConnector = async (id: string, change: { name?: string; allowedHosts?: string[] }) => (await gateway.patch<Connector>(`/v1/mcp/connectors/${enc(id)}`, change)).data;
export const deleteConnector = async (id: string) => (await gateway.delete(`/v1/mcp/connectors/${enc(id)}`)).data;

// ── Sign-in for people ──────────────────────────────────────────────────────────────────────────

export interface SignIn {
  configured: boolean;
  callbackUrl: string;
  issuer?: string;
  clientId?: string;
  secretHint?: string;
  groupsClaim?: string;
  extraScopes?: string[];
  sessionHours?: number;
  updatedAt?: string;
}
export const getSignIn = async () => (await gateway.get<SignIn>('/v1/mcp/sign-in')).data;
export const saveSignIn = async (input: { issuer: string; clientId: string; clientSecret?: string; groupsClaim: string; extraScopes: string[]; sessionHours: number }) =>
  (await gateway.put<SignIn>('/v1/mcp/sign-in', input)).data;
export const checkSignIn = async () => (await gateway.post<{ ok: boolean; message: string }>('/v1/mcp/sign-in/check', {})).data;
export const removeSignIn = async () => (await gateway.delete('/v1/mcp/sign-in')).data;

/** The full address agents use. In the dashboard the gateway sits behind /api; elsewhere it's its own host. */
export function serverUrl(path: string): string {
  const base = (import.meta.env.VITE_GATEWAY_PUBLIC_URL as string | undefined) || `${window.location.origin}/api`;
  return `${base.replace(/\/$/, '')}${path}`;
}

/** "HR, Finance leads" → ["HR", "Finance leads"]. */
export const splitList = (s: string) => [...new Set(s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))];
