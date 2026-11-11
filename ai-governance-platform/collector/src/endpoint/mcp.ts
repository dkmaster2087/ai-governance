import { createHash } from 'crypto';
import { Pseudonymizer } from '../core/sightings';
import { Store } from '../core/store';

/**
 * MCP servers configured on laptops, from the output of endpoint/mcp-scan.sh and mcp-scan.ps1 (one JSON line
 * per server, plus one per account scanned). People become pseudonyms here, like every other source.
 */

export const SCHEMA = 'probaline.endpoint_mcp/1';

export interface McpRow {
  day: string;
  kind: 'server' | 'scan';
  device: string; // device-<code>
  who: string; // user-<code>
  client?: string;
  clients?: string[];
  name?: string;
  transport?: 'stdio' | 'http' | 'sse';
  command?: string;
  package?: string;
  urlHost?: string;
  credentials?: boolean;
}

const SAFE = /[^\w.:@\-/]/g; // same characters other sources keep
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').slice(0, n) : undefined);

/** True when a file is scan output. */
export const isEndpointMcp = (text: string) => text.slice(0, 2000).includes(`"schema":"${SCHEMA}"`);

export function parseEndpointMcp(text: string, pseudonyms: Pseudonymizer): McpRow[] {
  const rows: McpRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes(SCHEMA)) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    if (o?.schema !== SCHEMA || typeof o.device !== 'string' || typeof o.user !== 'string') continue;
    const time = new Date(o.time);
    if (Number.isNaN(time.getTime())) continue;
    // Laptop names often carry their owner's name ("Janes-MacBook-Pro"), so devices become codes too.
    const device = pseudonyms.code(`device:${o.device.replace(SAFE, '').slice(0, 120).toLowerCase()}`).replace(/^user-/, 'device-');
    const base = { day: time.toISOString().slice(0, 10), device, who: pseudonyms.code(o.user) };
    if (o.kind === 'scan') {
      rows.push({ ...base, kind: 'scan', clients: Array.isArray(o.clients) ? o.clients.map((c: unknown) => str(c, 30)).filter(Boolean) : [] });
      continue;
    }
    const transport = ['stdio', 'http', 'sse'].includes(o.transport) ? o.transport : 'stdio';
    rows.push({
      ...base, kind: 'server', client: str(o.client, 30), name: str(o.name, 100), transport,
      ...(str(o.command, 60) ? { command: str(o.command, 60) } : {}),
      ...(str(o.package, 120) ? { package: str(o.package, 120) } : {}),
      ...(str(o.urlHost, 255) ? { urlHost: str(o.urlHost, 255)!.toLowerCase() } : {}),
      credentials: o.credentials === true,
    });
  }
  return rows;
}

/** Save one scan file's rows, one file per day; the same input again replaces its rows. */
export async function saveMcpRows(store: Store, inputName: string, rows: McpRow[]): Promise<number> {
  const batch = createHash('sha256').update(inputName).digest('hex').slice(0, 24);
  const byDay = new Map<string, McpRow[]>();
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  for (const [day, rs] of byDay) await store.put(`mcp/${day}/${batch}.jsonl`, rs.map((r) => JSON.stringify(r)).join('\n') + '\n', 'application/x-ndjson');
  return byDay.size;
}

export async function loadMcpRows(store: Store, from: string, to: string): Promise<McpRow[]> {
  const keys = (await store.list('mcp/')).filter((k) => { const d = k.split('/')[1]; return d >= from && d <= to && k.endsWith('.jsonl'); });
  const out: McpRow[] = [];
  for (const k of keys) for (const l of ((await store.get(k)) ?? '').split('\n')) if (l) out.push(JSON.parse(l));
  return out;
}

// ── Findings ─────────────────────────────────────────────────────────────────────────────────────────────

export interface LaptopMcpServer {
  /** What it is: the package, the URL's host, or the program. */
  what: string;
  names: string[];
  kind: 'local' | 'remote';
  clients: string[];
  devices: number;
  people: number;
  /** Devices where the server is given credentials of its own (environment or headers). */
  withCredentials: number;
  /** A remote server on one of the company's own domains or a private address. */
  company: boolean;
}

export interface LaptopMcp {
  scannedDevices: number;
  devicesWithServers: number;
  people: number;
  servers: LaptopMcpServer[];
}

const PRIVATE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost$|\[?::1\]?$|.*\.(local|internal|corp|lan|intranet)$)/;

export function isCompanyHost(host: string, companyDomains: string[]): boolean {
  const h = host.toLowerCase();
  return PRIVATE.test(h) || companyDomains.some((d) => { const c = d.trim().toLowerCase().replace(/^\*?\./, ''); return !!c && (h === c || h.endsWith(`.${c}`)); });
}

export function buildLaptopMcp(rows: McpRow[], companyDomains: string[] = []): LaptopMcp | undefined {
  if (rows.length === 0) return undefined;
  const servers = rows.filter((r) => r.kind === 'server');
  const groups = new Map<string, McpRow[]>();
  for (const r of servers) {
    const what = r.package ?? r.urlHost ?? r.command ?? r.name ?? 'unknown';
    const key = `${r.transport === 'stdio' ? 'local' : 'remote'}|${what}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const list: LaptopMcpServer[] = [...groups.entries()].map(([key, rs]) => {
    const [kind, what] = key.split('|') as ['local' | 'remote', string];
    return {
      what, kind,
      names: [...new Set(rs.map((r) => r.name!).filter(Boolean))].sort().slice(0, 5),
      clients: [...new Set(rs.map((r) => r.client!).filter(Boolean))].sort(),
      devices: new Set(rs.map((r) => r.device)).size,
      people: new Set(rs.map((r) => r.who)).size,
      withCredentials: new Set(rs.filter((r) => r.credentials).map((r) => r.device)).size,
      company: kind === 'remote' && isCompanyHost(what, companyDomains),
    };
  }).sort((a, b) => Number(b.company) - Number(a.company) || b.devices - a.devices || a.what.localeCompare(b.what));
  return {
    scannedDevices: new Set(rows.map((r) => r.device)).size,
    devicesWithServers: new Set(servers.map((r) => r.device)).size,
    people: new Set(servers.map((r) => r.who)).size,
    servers: list.slice(0, 100),
  };
}
