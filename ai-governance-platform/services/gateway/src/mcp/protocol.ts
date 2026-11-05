import { McpServer, McpTool } from './types';
import { ToolResult } from './calls';

/**
 * The Model Context Protocol over HTTP (Streamable HTTP transport): JSON-RPC 2.0 messages POSTed to the
 * server's address, answered with one JSON response. Probaline keeps no session state, so any gateway
 * instance can answer any message.
 */

export const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export type JsonRpcId = string | number | null;
export interface RpcRequest { jsonrpc: '2.0'; id?: JsonRpcId; method: string; params?: any }

export const rpcError = (id: JsonRpcId | undefined, code: number, message: string) => ({ jsonrpc: '2.0' as const, id: id ?? null, error: { code, message } });
const ok = (id: JsonRpcId | undefined, result: unknown) => ({ jsonrpc: '2.0' as const, id: id ?? null, result });

export interface Handlers {
  tools(): Promise<McpTool[]>;
  call(tool: McpTool, args: Record<string, unknown>): Promise<ToolResult>;
}

/** Answer one message. Returns null for notifications (no reply is sent). */
export async function handleMessage(server: McpServer, msg: RpcRequest, h: Handlers): Promise<object | null> {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid request');
  const isNotification = msg.id === undefined;
  if (isNotification) return null; // notifications/initialized and friends need no answer

  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '');
      return ok(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: `probaline-${server.serverId}`, title: server.name, version: '1.0.0' },
        instructions: [server.description, 'Tool calls go through Probaline: arguments are checked against company rules, and results may have personal data removed.'].filter(Boolean).join('\n\n'),
      });
    }
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list': {
      const tools = await h.tools();
      return ok(msg.id, {
        tools: tools.map((t) => ({
          name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: t.method === 'DELETE', openWorldHint: false },
        })),
      });
    }
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const tool = (await h.tools()).find((t) => t.name === name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      const args = msg.params?.arguments;
      if (args !== undefined && (typeof args !== 'object' || Array.isArray(args) || args === null)) return rpcError(msg.id, -32602, 'arguments must be an object');
      const r = await h.call(tool, args ?? {});
      return ok(msg.id, { content: [{ type: 'text', text: r.text }], isError: r.isError, _meta: { 'probaline/requestId': r.requestId } });
    }
    default:
      return rpcError(msg.id, -32601, `Method not supported: ${msg.method}`);
  }
}
