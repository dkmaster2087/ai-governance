import { Observation } from '../core/sightings';
import { serviceForAppName } from '../core/catalog';

/**
 * Sign-in exports from any identity provider without a parser of its own (OneLogin, Ping, JumpCloud, Duo,
 * Auth0, ADFS through a SIEM, …): JSON records or CSV rows with a user, an app and a time, under whichever
 * of the usual names the product uses. The app name is matched against the catalog.
 */

const USER = ['user', 'username', 'user_name', 'user_email', 'useremail', 'email', 'userprincipalname', 'upn', 'login', 'actor', 'principal', 'subject', 'account'];
const APP = ['app', 'application', 'app_name', 'appname', 'application_name', 'applicationname', 'appdisplayname', 'service_provider', 'serviceprovider', 'sp', 'client_name', 'clientname', 'integration', 'resource', 'target', 'relying_party', 'relyingparty'];
const TIME = ['time', 'timestamp', 'date', 'datetime', 'event_time', 'eventtime', 'created', 'createdat', 'created_at', 'published', 'occurred_at', 'login_time'];
const IP = ['ip', 'ip_address', 'ipaddress', 'client_ip', 'clientip', 'source_ip', 'src_ip'];
const RESULT = ['result', 'status', 'outcome', 'success'];

const norm = (k: string) => k.toLowerCase().replace(/[\s.-]+/g, '_').replace(/^_|_$/g, '');
const pickKey = (keys: string[], wanted: string[]) => keys.find((k) => wanted.includes(norm(k)) || wanted.includes(norm(k).replace(/_/g, '')));

/** The columns of a header row this parser can read, or null. */
export function idpColumns(keys: string[]): { user: string; app: string; time?: string; ip?: string; result?: string } | null {
  const user = pickKey(keys, USER);
  const app = pickKey(keys, APP);
  if (!user || !app) return null;
  return { user, app, time: pickKey(keys, TIME), ip: pickKey(keys, IP), result: pickKey(keys, RESULT) };
}

const failed = (v: unknown) => /^(fail|failure|failed|denied|error|false|blocked|rejected)$/i.test(String(v ?? '').trim());

const text = (v: unknown): string => {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return String(o.displayName ?? o.name ?? o.email ?? o.alternateId ?? o.id ?? '');
  }
  return String(v ?? '');
};

/** One record (a JSON object, or a CSV row as an object). */
export function parseIdpRecord(rec: Record<string, unknown>, fallback: Date): Observation | null {
  const cols = idpColumns(Object.keys(rec));
  if (!cols) return null;
  if (cols.result && failed(rec[cols.result])) return null;
  const service = serviceForAppName(text(rec[cols.app]));
  if (!service) return null;
  const user = text(rec[cols.user]).trim();
  const t = cols.time ? String(rec[cols.time] ?? '') : '';
  const time = t && !Number.isNaN(new Date(/^\d{10}$/.test(t) ? Number(t) * 1000 : /^\d{13}$/.test(t) ? Number(t) : t).getTime())
    ? (/^\d{10}$/.test(t) ? Number(t) * 1000 : /^\d{13}$/.test(t) ? Number(t) : t)
    : fallback;
  const who = user && user !== '-' ? { type: 'user' as const, value: user } : { type: 'ip' as const, value: cols.ip ? String(rec[cols.ip] ?? 'unknown') : 'unknown' };
  return { time, service: service.id, kind: 'browser', who, source: 'idp_signin' };
}
