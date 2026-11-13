import { BackendResponse } from './egress';
import { JsonSchema } from './openapi';

/**
 * A company's existing MCP server, put behind Probaline: Probaline is its only client. Agents connect to Probaline's
 * MCP server; Probaline lists the company server's tools once (when an admin adds it) and calls them on the
 * agents' behalf, through every check, over Streamable HTTP (directly, or through the connector inside the
 * company's network).
 *
 * Sessions: if the server hands out an `Mcp-Session-Id`, it's kept for ten minutes and sent back; a server that
 * forgets it (404) gets a new session once. Answers may come as JSON or as a short event stream.
 */

export const UPSTREAM_PROTOCOL = '2025-06-18';
const SESSION_TTL_MS = 10 * 60_000;

export class UpstreamError extends Error {
  constructor(message: string, readonly code = 'UPSTREAM_ERROR') { super(message); }
}

/** Sends one JSON-RPC message to the company's MCP server. */
export type UpstreamSend = (body: string, headers: Record<string, string>) => Promise<BackendResponse>;

export interface UpstreamTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** Unless the server marks a tool read-only, it's treated as one that changes data. */
  write: boolean;
}

export interface UpstreamResult { text: string; isError: boolean; omitted: number }

interface Session { id?: string; version: string; at: number }
const sessions = new Map<string, Session>();
export const forgetUpstreamSession = (apiId: string) => { sessions.delete(apiId); };

let nextId = 1;

/** Read a JSON-RPC answer with this id from a JSON body or an event stream. */
export function readAnswer(r: Pick<BackendResponse, 'contentType' | 'body'>, id: number): any {
  const messages: any[] = [];
  if (/text\/event-stream/i.test(r.contentType)) {
    for (const event of r.body.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
      if (!data) continue;
      try { messages.push(JSON.parse(data)); } catch { /* not JSON: skip */ }
    }
  } else {
    let parsed: unknown;
    try { parsed = JSON.parse(r.body); } catch { throw new UpstreamError('The MCP server didn\'t answer with JSON', 'UPSTREAM_BAD_ANSWER'); }
    messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  const answer = messages.find((m) => m && typeof m === 'object' && m.id === id);
  if (!answer) throw new UpstreamError('The MCP server didn\'t answer the request', 'UPSTREAM_BAD_ANSWER');
  if (answer.error) throw new UpstreamError(`The MCP server refused: ${String(answer.error.message ?? 'error').slice(0, 300)}`, 'UPSTREAM_REFUSED');
  return answer.result;
}

export class UpstreamMcp {
  constructor(private key: string, private send: UpstreamSend, private baseHeaders: Record<string, string> = {}) {}

  private headers(s: Session | undefined): Record<string, string> {
    return {
      ...this.baseHeaders,
      accept: 'application/json, text/event-stream',
      ...(s ? { 'mcp-protocol-version': s.version } : {}),
      ...(s?.id ? { 'mcp-session-id': s.id } : {}),
    };
  }

  private async session(): Promise<Session> {
    const cached = sessions.get(this.key);
    if (cached && Date.now() - cached.at < SESSION_TTL_MS) return cached;
    const id = nextId++;
    const r = await this.send(JSON.stringify({
      jsonrpc: '2.0', id, method: 'initialize',
      params: { protocolVersion: UPSTREAM_PROTOCOL, capabilities: {}, clientInfo: { name: 'probaline-gateway', version: '1.0.0' } },
    }), this.headers(undefined));
    if (r.status === 401 || r.status === 403) throw new UpstreamError(`The MCP server refused Probaline's credential (${r.status}). Check the token or header.`, 'UPSTREAM_AUTH');
    if (r.status >= 400) throw new UpstreamError(`The MCP server answered ${r.status} to initialize`, 'UPSTREAM_REFUSED');
    const result = readAnswer(r, id);
    const s: Session = { id: r.sessionId, version: String(result?.protocolVersion ?? UPSTREAM_PROTOCOL), at: Date.now() };
    await this.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), this.headers(s)).catch(() => undefined);
    if (sessions.size > 5000) sessions.clear();
    sessions.set(this.key, s);
    return s;
  }

  private async request(method: string, params: object, retried = false): Promise<any> {
    const s = await this.session();
    const id = nextId++;
    const r = await this.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }), this.headers(s));
    // The server forgot the session (restarted, or it expired): start a new one, once.
    if ((r.status === 404 || (r.status === 400 && s.id)) && !retried) {
      sessions.delete(this.key);
      return this.request(method, params, true);
    }
    if (r.status >= 400) throw new UpstreamError(`The MCP server answered ${r.status}`, r.status === 401 || r.status === 403 ? 'UPSTREAM_AUTH' : 'UPSTREAM_REFUSED');
    return readAnswer(r, id);
  }

  async listTools(max = 500): Promise<UpstreamTool[]> {
    const out: UpstreamTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20 && out.length < max; page++) {
      const result = await this.request('tools/list', cursor ? { cursor } : {});
      for (const t of (result?.tools ?? []) as any[]) {
        if (!t || typeof t.name !== 'string') continue;
        const a = t.annotations ?? {};
        out.push({
          name: t.name,
          title: String(t.title ?? a.title ?? t.name).slice(0, 120),
          description: String(t.description ?? '').slice(0, 2000),
          inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' },
          write: a.readOnlyHint !== true,
        });
      }
      cursor = result?.nextCursor;
      if (!cursor) break;
    }
    return out.slice(0, max);
  }

  /** Call one tool; the text parts of its answer are joined, anything else (images, audio) is left out and counted. */
  async callTool(name: string, args: Record<string, unknown>): Promise<UpstreamResult> {
    const result = await this.request('tools/call', { name, arguments: args });
    const parts: string[] = [];
    let omitted = 0;
    for (const c of (result?.content ?? []) as any[]) {
      if (c?.type === 'text' && typeof c.text === 'string') parts.push(c.text);
      else if (c?.type === 'resource' && typeof c.resource?.text === 'string') parts.push(c.resource.text);
      else omitted++;
    }
    if (!parts.length && result?.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
    return { text: parts.join('\n\n'), isError: result?.isError === true, omitted };
  }
}
