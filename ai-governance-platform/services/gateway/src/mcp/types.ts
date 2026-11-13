import { ArgumentCheckMode } from './argument-attacks';
import { JsonSchema, Operation } from './openapi';

export type ServerStatus = 'draft' | 'published' | 'paused';

export interface ServerAccess {
  /** Workloads: every API key with the `mcp` scope, or only the listed ones. */
  allKeys: boolean;
  keyIds: string[];
  /** People signed in through the company's identity provider: nobody, everyone, or members of these groups. */
  people: 'none' | 'all' | 'groups';
  groups: string[];
}

export interface ApprovalSettings {
  /** Who may approve: these email addresses, or any company admin when empty. */
  approvers: string[];
  /** How long an agent's call waits for a decision before it's told to ask again later. */
  waitSeconds: number;
  /** How long a request stays open. */
  expiresMinutes: number;
  /** Optional incoming webhook (Slack, Teams…) told when something waits. */
  webhookUrl?: string;
}

/** The parts of a server that are published as a version. */
export interface ServerConfig {
  name: string;
  description: string;
  access: ServerAccess;
  /** callsPerDay: tool calls per person or key per day (UTC); 0 means no daily limit. */
  limits: { callsPerMinute: number; maxResultBytes: number; callsPerDay?: number };
  /** Personal data in results is removed unless the admin turns this on for the server. */
  returnPersonalData?: boolean;
  /** Attacks in tool arguments (SQL injection, commands, path traversal…): stopped (default), recorded, or not checked. */
  argumentChecks?: ArgumentCheckMode;
  approvals: ApprovalSettings;
}

/**
 * An MCP server an admin created. It is configuration: the gateway serves it at /mcp/<tenant>/<serverId>.
 * Admins edit a draft (this record, and the server's APIs and tools); agents see the published version.
 */
export interface McpServer extends ServerConfig {
  tenantId: string;
  serverId: string;
  status: ServerStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  publishedAt?: string;
  /** The version agents see. Servers published before versions existed have none: agents see the draft. */
  publishedVersion?: number;
  /** The draft differs from the published version. */
  hasChanges?: boolean;
}

export type BackendAuth =
  | { type: 'none' }
  | { type: 'header'; header: string; secretArn?: string; hint?: string }
  | { type: 'bearer'; secretArn?: string; hint?: string };

/**
 * A backend added to a server: an API described by OpenAPI, or a company's existing MCP server (kind `mcp`,
 * baseUrl is its Streamable HTTP endpoint), which Probaline calls on agents' behalf.
 */
export interface McpApi {
  tenantId: string;
  apiId: string;
  serverId: string;
  name: string;
  kind?: 'openapi' | 'mcp';
  baseUrl: string;
  auth: BackendAuth;
  /** Reached through this connector in the company's network, instead of directly from the gateway. */
  connectorId?: string;
  openapi: { title: string; version: string; operations: number; skipped: string[] };
  createdAt: string;
}

/** One tool on one server, frozen at registration: the backend can't change what agents are told. */
export interface McpTool {
  tenantId: string;
  toolKey: string; // `${serverId}#${name}`
  serverId: string;
  apiId: string;
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  method: Operation['method'];
  path: string;
  params: Operation['params'];
  write: boolean;
  enabled: boolean;
  /** Write tools: run only after a person approves (the default), or run straight away. */
  approval?: 'required' | 'none';
  /** Only people in these groups get the tool (empty: everyone who can connect, including API keys). */
  groups?: string[];
  /** Calls to this tool per person or key per minute, on top of the server's limits; unset means only the server's. */
  callsPerMinute?: number;
  /** For a tool of a company's MCP server: its name there (the name agents see may be prefixed). */
  upstreamName?: string;
  createdAt: string;
}

/** A published version: what agents see until the next publish. Tools are stored as their own records. */
export interface McpVersion {
  tenantId: string;
  versionKey: string; // `${serverId}#v000001`
  serverId: string;
  version: number;
  note: string;
  publishedAt: string;
  publishedBy: string;
  config: ServerConfig;
  apis: McpApi[];
  toolCount: number;
}

export const DEFAULT_LIMITS = { callsPerMinute: 60, maxResultBytes: 100_000, callsPerDay: 0 };
export const DEFAULT_ACCESS: ServerAccess = { allKeys: true, keyIds: [], people: 'none', groups: [] };
export const DEFAULT_APPROVALS: ApprovalSettings = { approvers: [], waitSeconds: 45, expiresMinutes: 24 * 60 };

/** Fill in settings added after a server was created. */
export function withDefaults<T extends Partial<ServerConfig>>(s: T): T & ServerConfig {
  return {
    ...s,
    name: s.name ?? '',
    description: s.description ?? '',
    access: { ...DEFAULT_ACCESS, ...(s.access ?? {}) },
    limits: { ...DEFAULT_LIMITS, ...(s.limits ?? {}) },
    argumentChecks: s.argumentChecks ?? 'block',
    approvals: { ...DEFAULT_APPROVALS, ...(s.approvals ?? {}) },
  };
}

export const configOf = (s: ServerConfig): ServerConfig => ({
  name: s.name, description: s.description, access: s.access, limits: s.limits, returnPersonalData: !!s.returnPersonalData, argumentChecks: s.argumentChecks ?? 'block', approvals: s.approvals,
});
