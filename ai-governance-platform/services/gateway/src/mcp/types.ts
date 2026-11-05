import { JsonSchema, Operation } from './openapi';

export type ServerStatus = 'draft' | 'published' | 'paused';

/** An MCP server an admin created. It is configuration: the gateway serves it at /mcp/<tenant>/<serverId>. */
export interface McpServer {
  tenantId: string;
  serverId: string;
  name: string;
  description: string;
  status: ServerStatus;
  /** Who may connect: every API key with the `mcp` scope, or only the listed ones. */
  access: { allKeys: boolean; keyIds: string[] };
  limits: { callsPerMinute: number; maxResultBytes: number };
  /** Personal data in results is removed unless the admin turns this on for the server. */
  returnPersonalData?: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  publishedAt?: string;
}

export type BackendAuth =
  | { type: 'none' }
  | { type: 'header'; header: string; secretArn?: string; hint?: string }
  | { type: 'bearer'; secretArn?: string; hint?: string };

/** A backend API added to a server. */
export interface McpApi {
  tenantId: string;
  apiId: string;
  serverId: string;
  name: string;
  baseUrl: string;
  auth: BackendAuth;
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
  createdAt: string;
}

export const DEFAULT_LIMITS = { callsPerMinute: 60, maxResultBytes: 100_000 };
