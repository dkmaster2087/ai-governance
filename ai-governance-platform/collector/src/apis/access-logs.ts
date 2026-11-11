import { createHash } from 'crypto';
import { IdentityMatcher } from '../core/sightings';
import { Store } from '../core/store';

/**
 * Incoming verify: calls to the company's own APIs that are behind Probaline MCP servers, read from the APIs'
 * access logs (AWS ALB, API Gateway, nginx, Envoy). Each call came through Probaline (from the gateway's or a
 * connector's address) or went direct. The list of APIs comes from Probaline (Enforcement → Your APIs → API
 * list for the collector): hosts and base paths only.
 */

export const INVENTORY_SCHEMA = 'probaline.api_inventory/1';

export interface InventoryApi { apiId: string; name: string; server: string; host: string; basePath: string; connector?: string }
export interface Inventory { schema: string; generatedAt?: string; gateway?: { issuer?: string; egressIps?: string[] }; apis: InventoryApi[] }

export type ApiSource = 'alb_access' | 'apigw_access' | 'nginx_access' | 'envoy_access';

export const API_SOURCE_LABELS: Record<ApiSource, string> = {
  alb_access: 'AWS Application Load Balancer access logs',
  apigw_access: 'Amazon API Gateway access logs',
  nginx_access: 'nginx access logs',
  envoy_access: 'Envoy access logs',
};

/** One request as an access log line says it. */
export interface ApiRequest {
  time: Date;
  host?: string;
  path: string;
  clientIp: string;
  userAgent?: string;
  source: ApiSource;
}

export interface ApiCallRow {
  day: string;
  apiId: string;
  api: string;
  server: string;
  who: string; // ip:<address>
  client: string;
  source: ApiSource;
  via?: 'probaline';
  count: number;
}

// ── Inventory ────────────────────────────────────────────────────────────────────────────────────────────

export function isInventory(text: string): boolean {
  return text.slice(0, 500).includes(INVENTORY_SCHEMA);
}

export function parseInventory(text: string): Inventory {
  const o = JSON.parse(text);
  if (o?.schema !== INVENTORY_SCHEMA || !Array.isArray(o.apis)) throw new Error('Not a Probaline API list');
  return {
    schema: INVENTORY_SCHEMA,
    generatedAt: typeof o.generatedAt === 'string' ? o.generatedAt : undefined,
    gateway: { issuer: o.gateway?.issuer, egressIps: Array.isArray(o.gateway?.egressIps) ? o.gateway.egressIps.map(String) : [] },
    apis: o.apis.filter((a: any) => typeof a?.host === 'string').map((a: any) => ({
      apiId: String(a.apiId), name: String(a.name), server: String(a.server ?? ''), host: a.host.toLowerCase(),
      basePath: (String(a.basePath ?? '/').replace(/\/+$/, '') || '/'), ...(a.connector ? { connector: String(a.connector) } : {}),
    })),
  };
}

const INVENTORY_KEY = 'apis/inventory.json';
export const saveInventory = (store: Store, inv: Inventory) => store.put(INVENTORY_KEY, JSON.stringify(inv, null, 2), 'application/json');
export async function loadInventory(store: Store): Promise<Inventory | null> {
  const t = await store.get(INVENTORY_KEY);
  return t ? parseInventory(t) : null;
}

/** Which API a request is for: same host (default ports ignored), longest base path that prefixes the path. */
export function matchApi(inv: Inventory, host: string | undefined, path: string): InventoryApi | undefined {
  const h = host?.toLowerCase().replace(/:(80|443)$/, '');
  const p = path.split('?')[0];
  const under = (base: string) => base === '/' || p === base || p.startsWith(`${base}/`);
  let candidates = inv.apis.filter((a) => under(a.basePath));
  if (h) candidates = candidates.filter((a) => a.host.replace(/:(80|443)$/, '') === h);
  if (candidates.length === 0) return undefined;
  const longest = Math.max(...candidates.map((a) => a.basePath.length));
  const best = candidates.filter((a) => a.basePath.length === longest);
  // Without a host (plain nginx "combined"), the longest base path must belong to one host only.
  if (!h && new Set(best.map((a) => a.host)).size > 1) return undefined;
  return best[0];
}

// ── Log formats ──────────────────────────────────────────────────────────────────────────────────────────

/** Space-separated fields, with "quoted" and [bracketed] fields kept whole. */
function fields(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|\[([^\]]*)\]|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const ipOnly = (v: string) => v.replace(/^\[?([0-9a-f:.]+?)\]?(:\d+)?$/i, '$1');

/** ALB: `type time elb client:port target:port … "request" "user_agent" …`; request is `GET https://host:443/path HTTP/1.1`. */
export function parseAlbLine(line: string): ApiRequest | null {
  if (!/^(http|https|h2|grpcs|ws|wss) \d{4}-\d{2}-\d{2}T/.test(line)) return null;
  const f = fields(line);
  const [method, url] = (f[12] ?? '').split(' ');
  if (!method || !url) return null;
  try {
    const u = new URL(url);
    return { time: new Date(f[1]), host: u.host, path: u.pathname, clientIp: ipOnly(f[3]), userAgent: f[13], source: 'alb_access' };
  } catch { return null; }
}

/**
 * API Gateway access logs in JSON, with at least the source IP, method and path, e.g.
 * {"requestTimeEpoch":$context.requestTimeEpoch,"sourceIp":"$context.identity.sourceIp","domainName":"$context.domainName",
 *  "httpMethod":"$context.httpMethod","path":"$context.path","userAgent":"$context.identity.userAgent"}
 */
export function parseApiGatewayLine(line: string): ApiRequest | null {
  if (!line.startsWith('{') || !/"(httpMethod|routeKey)"/.test(line)) return null;
  let o: any;
  try { o = JSON.parse(line); } catch { return null; }
  const ip = o.sourceIp ?? o.ip ?? o.identity?.sourceIp;
  const path = o.path ?? o.resourcePath ?? (typeof o.routeKey === 'string' ? o.routeKey.split(' ')[1] : undefined);
  if (typeof ip !== 'string' || typeof path !== 'string') return null;
  const t = o.requestTimeEpoch ?? o.requestTime;
  const time = typeof t === 'number' ? new Date(t) : new Date(String(t).replace(/^(\d{2})\/(\w{3})\/(\d{4}):/, '$1 $2 $3 '));
  return { time, host: o.domainName, path, clientIp: ip, userAgent: o.userAgent ?? o.identity?.userAgent, source: 'apigw_access' };
}

const CLF_TIME = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/;
function clfTime(t: string): Date {
  const m = CLF_TIME.exec(t);
  if (!m) return new Date(NaN);
  return new Date(`${m[2]} ${m[1]} ${m[3]} ${m[4]}:${m[5]}:${m[6]} GMT${m[7]}`);
}

/** nginx `combined`, optionally with the host first (`vhost_combined`: `host:port ip - user [time] "request" …`). */
export function parseNginxLine(line: string): ApiRequest | null {
  const f = fields(line);
  let i = 0;
  let host: string | undefined;
  if (f.length >= 10 && /^[a-z0-9.-]+(:\d+)?$/i.test(f[0]) && /^[0-9a-f:.]+$/i.test(f[1]) && f[2] === '-') { host = f[0]; i = 1; }
  if (!/^[0-9a-f:.]+$/i.test(f[i] ?? '') || !CLF_TIME.test(f[i + 3] ?? '')) return null;
  const [, path] = (f[i + 4] ?? '').split(' ');
  if (!path) return null;
  return { time: clfTime(f[i + 3]), host, path, clientIp: f[i], userAgent: f[i + 8], source: 'nginx_access' };
}

/**
 * Envoy's default format: `[time] "METHOD path PROTO" code flags rx tx duration upstream_time "x-forwarded-for"
 * "user-agent" "request-id" "authority" "upstream-host"`. The caller is the first X-Forwarded-For address.
 */
export function parseEnvoyLine(line: string): ApiRequest | null {
  if (!line.startsWith('[')) return null;
  const f = fields(line);
  if (f.length < 12 || !/^\d{4}-\d{2}-\d{2}T/.test(f[0])) return null;
  const [, path] = (f[1] ?? '').split(' ');
  const xff = (f[8] ?? '').split(',')[0].trim();
  if (!path || !xff || xff === '-') return null;
  return { time: new Date(f[0]), host: f[11] !== '-' ? f[11] : undefined, path, clientIp: xff, userAgent: f[9] !== '-' ? f[9] : undefined, source: 'envoy_access' };
}

const PARSERS = [parseAlbLine, parseApiGatewayLine, parseEnvoyLine, parseNginxLine];

/** Which access-log format a file is, from its first lines; null when it's none of them. */
export function detectApiLog(text: string): ((line: string) => ApiRequest | null) | null {
  const lines = text.split('\n').filter((l) => l.trim()).slice(0, 20);
  for (const p of PARSERS) if (lines.some((l) => p(l))) return p;
  return null;
}

// ── Callers ──────────────────────────────────────────────────────────────────────────────────────────────

/** What made the call, as far as the user agent says. Agents' own HTTP clients are often plain libraries. */
export function clientOf(ua?: string): string {
  const u = ua ?? '';
  if (/Probaline-MCP/i.test(u)) return 'Claims to be Probaline';
  if (/Claude-User|Claude-Code|anthropic|claude/i.test(u)) return 'Claude';
  if (/ChatGPT-User|OpenAI|openai/i.test(u)) return 'ChatGPT or OpenAI';
  if (/Cursor/i.test(u)) return 'Cursor';
  if (/python-requests|python-httpx|aiohttp|python-urllib/i.test(u)) return 'Python script';
  if (/node-fetch|undici|axios|node\b/i.test(u)) return 'Node script';
  if (/^curl\//i.test(u)) return 'curl';
  if (/Mozilla\//.test(u)) return 'Browser';
  return u ? 'Other' : 'Unknown';
}

export interface ClassifyOptions { gateway: string[] }

/** Calls to APIs in the inventory, as daily counts per API, caller, client and source. */
export function classify(requests: Iterable<ApiRequest>, inv: Inventory, o: ClassifyOptions): { rows: ApiCallRow[]; seen: number; matched: number } {
  // The gateway's outbound addresses from the API list, plus --gateway (connector hosts, other gateways).
  const probaline = new IdentityMatcher([...o.gateway, ...(inv.gateway?.egressIps ?? []).map((ip) => `ip:${ip}`)]);
  const rows = new Map<string, ApiCallRow>();
  let seen = 0; let matched = 0;
  for (const r of requests) {
    seen++;
    if (Number.isNaN(r.time.getTime())) continue;
    const api = matchApi(inv, r.host, r.path);
    if (!api) continue;
    matched++;
    const ip = ipOnly(r.clientIp);
    const via = probaline.matches('ip', ip);
    const row: ApiCallRow = {
      day: r.time.toISOString().slice(0, 10), apiId: api.apiId, api: api.name, server: api.server,
      who: `ip:${ip.replace(/[^0-9a-f:.]/gi, '').slice(0, 64)}`, client: via ? 'Probaline' : clientOf(r.userAgent), source: r.source,
      ...(via ? { via: 'probaline' as const } : {}), count: 1,
    };
    const key = [row.day, row.apiId, row.who, row.client, row.source, row.via ?? ''].join('|');
    const e = rows.get(key);
    if (e) e.count++; else rows.set(key, row);
  }
  return { rows: [...rows.values()], seen, matched };
}

export async function saveApiCalls(store: Store, inputName: string, rows: ApiCallRow[]): Promise<void> {
  const batch = createHash('sha256').update(inputName).digest('hex').slice(0, 24);
  const byDay = new Map<string, ApiCallRow[]>();
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  for (const [day, rs] of byDay) await store.put(`apicalls/${day}/${batch}.jsonl`, rs.map((r) => JSON.stringify(r)).join('\n') + '\n', 'application/x-ndjson');
}

export async function loadApiCalls(store: Store, from: string, to: string): Promise<ApiCallRow[]> {
  const keys = (await store.list('apicalls/')).filter((k) => { const d = k.split('/')[1]; return d >= from && d <= to && k.endsWith('.jsonl'); });
  const out: ApiCallRow[] = [];
  for (const k of keys) for (const l of ((await store.get(k)) ?? '').split('\n')) if (l) out.push(JSON.parse(l));
  return out;
}
