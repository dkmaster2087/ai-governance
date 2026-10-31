import { Actor, Observation } from '../core/sightings';

/**
 * On-premises log lines: syslog from firewalls and proxies, and DNS / proxy log files. Each line is
 * recognized by its shape, so one syslog port can take several products at once.
 */

export type OnpremSource = 'syslog_paloalto' | 'syslog_fortinet' | 'syslog_cef' | 'squid' | 'bind_dns' | 'windows_dns';

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

export interface SyslogFrame { time?: Date; host?: string; msg: string }

/** Strip an RFC 5424 or RFC 3164 syslog header, if there is one. */
export function unwrapSyslog(line: string, now = new Date()): SyslogFrame {
  const l = line.replace(/^\uFEFF/, '').trimEnd();
  const r5424 = /^<\d{1,3}>1 (\S+) (\S+) \S+ \S+ \S+ (-|(?:\[(?:[^\]\\]|\\.)*\])+) ?(.*)$/s.exec(l);
  if (r5424) {
    const t = r5424[1] === '-' ? undefined : new Date(r5424[1]);
    return { time: t && !Number.isNaN(t.getTime()) ? t : undefined, host: r5424[2], msg: r5424[4].replace(/^\uFEFF/, '') };
  }
  const r3164 = /^<\d{1,3}>([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\S+) (.*)$/s.exec(l);
  if (r3164 && MONTHS[r3164[1]] !== undefined) {
    // RFC 3164 has no year or zone: assume this year, UTC, and last year if that would be in the future.
    let t = new Date(Date.UTC(now.getUTCFullYear(), MONTHS[r3164[1]], Number(r3164[2]), Number(r3164[3]), Number(r3164[4]), Number(r3164[5])));
    if (t.getTime() - now.getTime() > 86_400_000) t = new Date(Date.UTC(now.getUTCFullYear() - 1, t.getUTCMonth(), t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds()));
    return { time: t, host: r3164[6], msg: r3164[7] };
  }
  const pri = /^<\d{1,3}>(.*)$/s.exec(l);
  return { msg: pri ? pri[1] : l };
}

/** The host part of a URL, `host:port` or bare host. */
export function hostOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let v = value.trim().replace(/^"|"$/g, '');
  if (!v || v === '-') return undefined;
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  v = v.split(/[/?#]/)[0];
  v = v.replace(/^[^@]*@/, '');
  if (v.startsWith('[')) return undefined; // IPv6 literal: not a name
  v = v.replace(/:\d+$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}\.?$/i.test(v) ? v.toLowerCase() : undefined;
}

const actor = (user: string | undefined, ip: string | undefined): Actor => {
  const u = user?.trim().replace(/^"|"$/g, '');
  if (u && u !== '-' && u.toLowerCase() !== 'unknown' && u !== 'N/A') return { type: 'user', value: u };
  return { type: 'ip', value: (ip ?? 'unknown').trim() || 'unknown' };
};

/** `key=value key="value with spaces"` (Fortinet and similar). */
export function keyValues(msg: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_][\w.-]*)=("(?:[^"\\]|\\.)*"|\S*)/g;
  let m;
  while ((m = re.exec(msg))) out[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1).replace(/\\"/g, '"') : m[2];
  return out;
}

/** CEF extension: values run until the next ` key=`; `\=` and `\\` are escapes. */
export function cefExtension(ext: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(?:^|\s)([A-Za-z0-9_]+)=((?:[^=\\]|\\.)*?)(?=\s+[A-Za-z0-9_]+=|$)/g;
  let m;
  while ((m = re.exec(ext))) out[m[1]] = m[2].replace(/\\([=\\])/g, '$1').trim();
  return out;
}

/** Minimal CSV for one line, with quoted fields. */
export function csv(line: string): string[] {
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

const validDate = (t: Date | undefined) => (t && !Number.isNaN(t.getTime()) ? t : undefined);

function paloAlto(msg: string, fallback: Date): Observation | null {
  // PAN-OS THREAT log, URL subtype: receive time (1), source address (7), source user (12), URL (31).
  if (!/^[^,]*,\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2},[^,]*,THREAT,url,/.test(msg)) return null;
  const f = csv(msg);
  const domain = hostOf(f[31]);
  if (!domain) return null;
  const t = validDate(new Date(`${f[1].replace(/\//g, '-').replace(' ', 'T')}Z`));
  return { time: t ?? fallback, domain, who: actor(f[12], f[7]), source: 'syslog_paloalto' };
}

function fortinet(msg: string, fallback: Date): Observation | null {
  if (!/\blogid="?\d+/.test(msg) || !/\b(devid|devname)=/.test(msg)) return null;
  const kv = keyValues(msg);
  const domain = hostOf(kv.hostname) ?? hostOf(kv.qname) ?? hostOf(kv.url?.startsWith('http') ? kv.url : undefined);
  if (!domain) return null;
  let t: Date | undefined;
  if (kv.eventtime && /^\d{10,19}$/.test(kv.eventtime)) t = new Date(Number(kv.eventtime.slice(0, 13).padEnd(13, '0')));
  else if (kv.date && kv.time) t = validDate(new Date(`${kv.date}T${kv.time}Z`));
  const bytes = Number(kv.sentbyte);
  return {
    time: validDate(t) ?? fallback, domain, who: actor(kv.user ?? kv.unauthuser, kv.srcip), source: 'syslog_fortinet',
    ...(Number.isFinite(bytes) && bytes > 0 ? { bytesOut: bytes } : {}),
  };
}

function cef(msg: string, fallback: Date): Observation | null {
  const i = msg.indexOf('CEF:');
  if (i < 0) return null;
  const parts = msg.slice(i).split(/(?<!\\)\|/);
  if (parts.length < 8) return null;
  const ext = cefExtension(parts.slice(7).join('|'));
  const domain = hostOf(ext.dhost) ?? hostOf(ext.destinationDnsDomain) ?? hostOf(ext.request) ?? hostOf(ext.requestUrl);
  if (!domain) return null;
  let t: Date | undefined;
  if (ext.rt && /^\d{12,13}$/.test(ext.rt)) t = new Date(Number(ext.rt));
  else if (ext.rt) t = validDate(new Date(ext.rt));
  const bytes = Number(ext.out);
  return {
    time: validDate(t) ?? fallback, domain, who: actor(ext.suser, ext.src), source: 'syslog_cef',
    ...(Number.isFinite(bytes) && bytes > 0 ? { bytesOut: bytes } : {}),
  };
}

function squid(msg: string): Observation | null {
  // time.ms elapsed client code/status bytes method URL ident hierarchy/peer type
  const m = /^(\d{9,11}\.\d{1,3})\s+\d+\s+(\S+)\s+\S+\/\d{3}\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)/.exec(msg);
  if (!m) return null;
  const domain = hostOf(m[5]);
  if (!domain) return null;
  return { time: Number(m[1]) * 1000, domain, who: actor(m[6], m[2]), source: 'squid' };
}

function bind(msg: string, fallback: Date): Observation | null {
  const m = /client (?:@\S+ )?([0-9a-fA-F.:]+)#\d+(?: \([^)]*\))?: (?:view \S+: )?query: (\S+) IN /.exec(msg);
  if (!m) return null;
  const domain = hostOf(m[2]);
  if (!domain) return null;
  const d = /^(\d{2})-([A-Z][a-z]{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})/.exec(msg);
  const t = d && MONTHS[d[2]] !== undefined ? new Date(Date.UTC(+d[3], MONTHS[d[2]], +d[1], +d[4], +d[5], +d[6])) : undefined;
  return { time: t ?? fallback, domain, who: { type: 'ip', value: m[1] }, source: 'bind_dns' };
}

/** Windows DNS debug log: names are written as (7)chatgpt(3)com(0). */
export function decodeWindowsName(encoded: string): string {
  return encoded.replace(/\(\d+\)/g, '.').replace(/^\.|\.$/g, '');
}

function windowsDns(msg: string, fallback: Date): Observation | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})(?: ([AP]M))? .*?\b(?:UDP|TCP) Rcv ([0-9a-fA-F.:]+)\s+\S+\s+Q \[[^\]]*\]\s+\S+\s+(\(\d+\)\S+)/.exec(msg);
  if (!m) return null;
  const domain = hostOf(decodeWindowsName(m[9]));
  if (!domain) return null;
  let hour = Number(m[4]);
  if (m[7] === 'PM' && hour < 12) hour += 12;
  if (m[7] === 'AM' && hour === 12) hour = 0;
  // Month/day order follows the server's locale; US order is the default.
  const t = validDate(new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], hour, +m[5], +m[6])));
  return { time: t ?? fallback, domain, who: { type: 'ip', value: m[8] }, source: 'windows_dns' };
}

/** One log line from any supported on-premises product, or null if it isn't one or names no host. */
export function parseOnpremLine(line: string, receivedAt = new Date()): Observation | null {
  if (!line || line.length > 65_536) return null;
  const frame = unwrapSyslog(line, receivedAt);
  const fallback = frame.time ?? receivedAt;
  const msg = frame.msg;
  return cef(msg, fallback)
    ?? fortinet(msg, fallback)
    ?? paloAlto(msg.replace(/^\S+:\s/, ''), fallback) ?? paloAlto(msg, fallback)
    ?? squid(msg)
    ?? bind(msg, fallback)
    ?? windowsDns(msg, fallback);
}

export function* parseOnpremText(text: string, receivedAt = new Date()): Generator<Observation> {
  for (const line of text.split(/\r?\n/)) {
    const o = parseOnpremLine(line, receivedAt);
    if (o) yield o;
  }
}
