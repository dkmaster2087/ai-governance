import { Actor, Observation } from '../core/sightings';

/**
 * Security service edge logs: Zscaler Internet Access and Netskope. These see laptops wherever they are,
 * which firewall and DNS logs miss once people leave the office.
 *
 * Zscaler's log appliance (NSS) streams web logs over syslog in a format the customer chooses; JSON,
 * LEEF (QRadar), key=value (Splunk) and CEF (ArcSight) are read here or by the CEF parser. Netskope
 * sends events as JSON or CEF through its Cloud Log Shipper, and streams transaction logs as files
 * with a header row (CSV or W3C `#Fields:`), which `HeaderTable` reads.
 */

export type SseSource = 'zscaler' | 'netskope' | 'syslog_leef';

const validDate = (t: Date | undefined) => (t && !Number.isNaN(t.getTime()) ? t : undefined);

/** Epoch seconds or milliseconds, or a date string; times without a zone are read as UTC. */
export function timeOf(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const s = String(value).trim();
  if (/^\d{9,10}(\.\d+)?$/.test(s)) return validDate(new Date(Number(s) * 1000));
  if (/^\d{12,13}$/.test(s)) return validDate(new Date(Number(s)));
  // Zscaler's default `datetime` looks like "Mon Jun 20 15:29:11 2022".
  const z = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}:\d{2}:\d{2}) (\d{4})$/.exec(s);
  if (z) return validDate(new Date(`${z[1]} ${z[2]} ${z[4]} ${z[3]} UTC`));
  const hasZone = /(Z|[+-]\d{2}:?\d{2}|UTC|GMT)$/i.test(s);
  return validDate(new Date(hasZone ? s : `${s.replace(' ', 'T')}Z`));
}

/** The host part of a URL, `host:port` or bare host; percent-encoded URLs are decoded first. */
export function hostOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  let v = String(value).trim().replace(/^"|"$/g, '');
  if (!v || v === '-' || v.toLowerCase() === 'none') return undefined;
  if (/%[0-9a-f]{2}/i.test(v)) { try { v = decodeURIComponent(v); } catch { /* keep as is */ } }
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0].replace(/^[^@]*@/, '');
  if (v.startsWith('[')) return undefined;
  v = v.replace(/:\d+$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}\.?$/i.test(v) ? v.toLowerCase().replace(/\.$/, '') : undefined;
}

const NOBODY = new Set(['', '-', 'unknown', 'n/a', 'none', 'null']);
function actor(user: unknown, ip: unknown): Actor {
  const u = user === undefined || user === null ? '' : String(user).trim().replace(/^"|"$/g, '');
  if (!NOBODY.has(u.toLowerCase())) return { type: 'user', value: u };
  const i = ip === undefined || ip === null ? '' : String(ip).trim();
  return { type: 'ip', value: NOBODY.has(i.toLowerCase()) ? 'unknown' : i };
}

const first = (rec: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (rec[k] !== undefined && rec[k] !== null && rec[k] !== '') return rec[k];
  return undefined;
};

function bytes(value: unknown): { bytesOut?: number } {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? { bytesOut: n } : {};
}

// ── Zscaler ─────────────────────────────────────────────────────────────────────────────────────

/** A Zscaler web log record, whichever feed format it came in, as field → value. */
function zscalerRecord(rec: Record<string, unknown>, fallback: Date): Observation | null {
  const domain = hostOf(first(rec, 'hostname', 'ehost', 'host', 'dhost')) ?? hostOf(first(rec, 'url', 'eurl', 'request'));
  if (!domain) return null;
  return {
    time: timeOf(first(rec, 'epochtime', 'devTime', 'datetime', 'time', 'rt')) ?? fallback,
    domain,
    who: actor(first(rec, 'login', 'user', 'usrName', 'suser', 'elogin'), first(rec, 'cip', 'ClientIP', 'clientip', 'src')),
    source: 'zscaler',
    ...bytes(first(rec, 'requestsize', 'reqsize', 'out')),
  };
}

const looksZscaler = (rec: Record<string, unknown>) =>
  /zscaler/i.test(String(rec.vendor ?? rec.sourcetype ?? '')) || /^NSS/i.test(String(rec.product ?? ''))
  || (rec.login !== undefined && rec.urlcategory !== undefined);

// ── Netskope ────────────────────────────────────────────────────────────────────────────────────

function netskopeRecord(rec: Record<string, unknown>, fallback: Date): Observation | null {
  const domain = hostOf(first(rec, 'domain', 'hostname', 'dsthost', 'cs-host', 'x-cs-site-host'))
    ?? hostOf(first(rec, 'url', 'cs-uri', 'page', 'x-cs-url'));
  if (!domain) return null;
  let time = timeOf(first(rec, 'timestamp', '_insertion_epoch_timestamp', 'x-cs-timestamp'));
  if (!time && rec.date && rec.time) time = timeOf(`${rec.date} ${rec.time}`);
  return {
    time: time ?? fallback,
    domain,
    who: actor(first(rec, 'ur_normalized', 'user', 'userkey', 'cs-username', 'x-cs-userip-user'), first(rec, 'srcip', 'userip', 'c-ip', 'x-cs-userip')),
    source: 'netskope',
    ...bytes(first(rec, 'client_bytes', 'cs-bytes')),
  };
}

const looksNetskope = (rec: Record<string, unknown>) =>
  rec.ur_normalized !== undefined || rec.access_method !== undefined || rec.appcategory !== undefined
  || /netskope/i.test(String(rec.vendor ?? rec.product ?? ''));

// ── Line formats ────────────────────────────────────────────────────────────────────────────────

function json(msg: string, fallback: Date): Observation | null {
  const i = msg.indexOf('{');
  if (i < 0 || !msg.trimEnd().endsWith('}')) return null;
  let rec: Record<string, unknown>;
  try { rec = JSON.parse(msg.slice(i)); } catch { return null; }
  if (!rec || typeof rec !== 'object') return null;
  // Splunk HEC style wraps the record: { "sourcetype": "zscalernss-web", "event": { … } }.
  if (rec.event && typeof rec.event === 'object') {
    const inner = rec.event as Record<string, unknown>;
    if (/zscaler/i.test(String(rec.sourcetype ?? '')) || looksZscaler(inner)) return zscalerRecord(inner, fallback);
    if (looksNetskope(inner)) return netskopeRecord(inner, fallback);
    return null;
  }
  if (looksZscaler(rec)) return zscalerRecord(rec, fallback);
  if (looksNetskope(rec)) return netskopeRecord(rec, fallback);
  return null;
}

/** LEEF 1.0 (tab-separated) or 2.0 (delimiter given in the header): `LEEF:1.0|Vendor|Product|Ver|Event|k=v\tk=v`. */
export function leefFields(msg: string): { vendor: string; fields: Record<string, string> } | null {
  const i = msg.indexOf('LEEF:');
  if (i < 0) return null;
  const parts = msg.slice(i).split('|');
  if (parts.length < 6) return null;
  const v2 = parts[0] === 'LEEF:2.0';
  let delim = '\t';
  let rest = parts.slice(5).join('|');
  if (v2 && parts.length >= 7) {
    const d = parts[5];
    delim = d.startsWith('x') || d.startsWith('0x') ? String.fromCharCode(parseInt(d.replace(/^0?x/, ''), 16)) : d || '\t';
    rest = parts.slice(6).join('|');
  }
  const fields: Record<string, string> = {};
  for (const pair of rest.split(delim)) {
    const eq = pair.indexOf('=');
    if (eq > 0) fields[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return { vendor: parts[1], fields };
}

function leef(msg: string, fallback: Date): Observation | null {
  const l = leefFields(msg);
  if (!l) return null;
  if (/zscaler/i.test(l.vendor)) return zscalerRecord(l.fields, fallback);
  if (/netskope/i.test(l.vendor)) return netskopeRecord(l.fields, fallback);
  const f = l.fields;
  const domain = hostOf(first(f, 'dhost', 'host', 'domain')) ?? hostOf(first(f, 'url', 'request'));
  if (!domain) return null;
  return { time: timeOf(first(f, 'devTime', 'rt')) ?? fallback, domain, who: actor(first(f, 'usrName', 'suser'), f.src), source: 'syslog_leef', ...bytes(first(f, 'srcBytes', 'out')) };
}

/** Zscaler's Splunk-style feed: `key=value` pairs with Zscaler field names. */
function zscalerKeyValues(msg: string, fallback: Date): Observation | null {
  if (!/\b(login|cip)=/.test(msg) || !/\b(urlcategory|appclass|urlclass)=/.test(msg)) return null;
  const rec: Record<string, string> = {};
  const re = /([A-Za-z_][\w.-]*)=("(?:[^"\\]|\\.)*"|\S*)/g;
  let m;
  while ((m = re.exec(msg))) rec[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1).replace(/\\"/g, '"') : m[2];
  return zscalerRecord(rec, fallback);
}

/** One Zscaler or Netskope line (JSON, LEEF or key=value), or null. CEF is read by the CEF parser. */
export function parseSseMessage(msg: string, fallback: Date): Observation | null {
  return json(msg, fallback) ?? leef(msg, fallback) ?? zscalerKeyValues(msg, fallback);
}

// ── Files with a header row (Netskope log streaming) ────────────────────────────────────────────

/** Split a W3C extended log line: space-separated, values with spaces in double quotes. */
export function w3cFields(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.|"")*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2]);
  return out;
}

function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Column names that mark a header row as Netskope's. */
const NETSKOPE_COLUMNS = ['cs-host', 'cs-uri', 'cs-username', 'x-cs-site', 'x-cs-app', 'x-cs-access-method'];

/**
 * Remembers a file's header row (CSV, or a W3C `#Fields:` line) and reads the rows under it. One per
 * file being read; its state can be saved and restored so tailing a file survives a restart.
 */
export class HeaderTable {
  constructor(public header?: { format: 'csv' | 'w3c'; columns: string[] }) {}

  /** Returns true if the line was a header (and so holds no event). */
  private takeHeader(line: string): boolean {
    if (line.startsWith('#Fields:')) {
      this.header = { format: 'w3c', columns: line.slice(8).trim().split(/\s+/) };
      return true;
    }
    if (line.startsWith('#')) return true; // other W3C directives (#Version, #Date)
    if (!line.includes(',') || !NETSKOPE_COLUMNS.some((c) => line.includes(c))) return false;
    const cols = csvFields(line).map((c) => c.trim());
    if (cols.filter((c) => NETSKOPE_COLUMNS.includes(c)).length >= 2) {
      this.header = { format: 'csv', columns: cols };
      return true;
    }
    return false;
  }

  /** One line: null for a header, a row with no destination, or a line this table doesn't read. */
  line(line: string, fallback: Date): Observation | null | undefined {
    if (this.takeHeader(line)) return null;
    if (!this.header) return undefined; // not ours: let other parsers try
    const values = this.header.format === 'w3c' ? w3cFields(line) : csvFields(line);
    if (values.length !== this.header.columns.length) return undefined;
    const rec: Record<string, string> = {};
    this.header.columns.forEach((c, i) => { rec[c] = values[i]; });
    return netskopeRecord(rec, fallback);
  }
}
