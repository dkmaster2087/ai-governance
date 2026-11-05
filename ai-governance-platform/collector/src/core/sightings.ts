import { createHmac } from 'crypto';
import { AiService, normalizeDomain, serviceById, serviceForDomain } from './catalog';

/** How the AI service was reached. */
export type Kind = 'api' | 'browser' | 'cloud_ai';

/**
 * One line of the common format: how often one source saw one "who" reach one AI service on one day.
 * Every parser produces these, whatever the log.
 */
export interface Sighting {
  day: string; // YYYY-MM-DD, UTC
  service: string; // catalog id
  domain: string;
  kind: Kind;
  who: string; // host:…, ip:…, role:…, user:<pseudonym>
  source: string; // aws_dns, aws_firewall, aws_cloudtrail, …
  count: number;
  bytesOut?: number;
}

/** Who did it, as the log says. Only `user` is a person; it is replaced with a pseudonym. */
export interface Actor {
  type: 'host' | 'ip' | 'role' | 'user';
  value: string;
}

/** What a parser saw in one log line. */
export interface Observation {
  time: string | number | Date;
  /** The domain contacted; or, for cloud audit logs, `service` directly. */
  domain?: string;
  service?: string;
  kind?: Kind;
  who: Actor;
  source: string;
  count?: number;
  bytesOut?: number;
}

/**
 * One person, however a log writes them: `ACME\\jdoe`, `jdoe` and `jdoe@acme.example` are the same account.
 * Assumes one company's directory, where the short name is unique.
 */
export function canonicalUser(name: string): string {
  return name.trim().toLowerCase().replace(/^[^\\]*\\/, '').replace(/@.*$/, '');
}

/** Replaces people with stable codes. The key is generated in the customer's environment and stays there. */
export class Pseudonymizer {
  /** code → real name, kept only where the customer keeps the key. */
  readonly names = new Map<string, string>();

  constructor(private readonly key: string) {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Pseudonym key must be 32 bytes of hex');
  }

  code(name: string): string {
    const code = `user-${createHmac('sha256', Buffer.from(this.key, 'hex')).update(canonicalUser(name)).digest('hex').slice(0, 12)}`;
    if (!this.names.has(code)) this.names.set(code, name.trim().toLowerCase());
    return code;
  }
}

/** Default kind from the service's category, when the log doesn't say. */
function kindFor(service: AiService): Kind {
  if (service.category === 'cloud_ai') return 'cloud_ai';
  if (service.category === 'model_api') return 'api';
  return 'browser';
}

export interface AggregatorOptions {
  pseudonyms: Pseudonymizer;
  /** Actors to skip, as `type:value` (e.g. `role:probaline-gateway-task`): Probaline itself and other known-good callers. */
  ignore?: string[];
}

const UNSAFE = /[^\w.:@\-/]/g;

/** Turns observations into sightings, merging repeats. Lines that aren't AI traffic are dropped here. */
export class Aggregator {
  private rows = new Map<string, Sighting>();
  private ignore: Set<string>;
  seen = 0;
  matched = 0;

  constructor(private readonly opts: AggregatorOptions) {
    this.ignore = new Set((opts.ignore ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean));
  }

  get pseudonyms(): Pseudonymizer {
    return this.opts.pseudonyms;
  }

  add(o: Observation): void {
    this.seen++;
    const service = o.service ? serviceById(o.service) : o.domain ? serviceForDomain(o.domain) : undefined;
    if (!service) return;
    const time = new Date(o.time);
    if (Number.isNaN(time.getTime())) return;

    const rawWho = `${o.who.type}:${o.who.value}`.toLowerCase();
    if (this.ignore.has(rawWho) || this.ignore.has(`${o.who.type}:*`)) return;
    const who = o.who.type === 'user'
      ? this.opts.pseudonyms.code(o.who.value)
      : `${o.who.type}:${o.who.value.replace(UNSAFE, '').slice(0, 200)}`;

    this.matched++;
    const row: Sighting = {
      day: time.toISOString().slice(0, 10),
      service: service.id,
      domain: o.domain ? normalizeDomain(o.domain) : service.domains[0] ?? service.id,
      kind: o.kind ?? kindFor(service),
      who,
      source: o.source,
      count: o.count ?? 1,
      ...(o.bytesOut !== undefined ? { bytesOut: o.bytesOut } : {}),
    };
    const key = [row.day, row.service, row.domain, row.kind, row.who, row.source].join('|');
    const existing = this.rows.get(key);
    if (existing) {
      existing.count += row.count;
      if (row.bytesOut !== undefined) existing.bytesOut = (existing.bytesOut ?? 0) + row.bytesOut;
    } else {
      this.rows.set(key, row);
    }
  }

  sightings(): Sighting[] {
    return [...this.rows.values()];
  }

  /** Sightings grouped by day, for writing one file per day. */
  byDay(): Map<string, Sighting[]> {
    const out = new Map<string, Sighting[]>();
    for (const s of this.rows.values()) out.set(s.day, [...(out.get(s.day) ?? []), s]);
    return out;
  }
}

/** Merge sightings from several files (the same key may appear in more than one). */
export function mergeSightings(lists: Sighting[][]): Sighting[] {
  const rows = new Map<string, Sighting>();
  for (const list of lists) {
    for (const s of list) {
      const key = [s.day, s.service, s.domain, s.kind, s.who, s.source].join('|');
      const e = rows.get(key);
      if (!e) rows.set(key, { ...s });
      else {
        e.count += s.count;
        if (s.bytesOut !== undefined) e.bytesOut = (e.bytesOut ?? 0) + s.bytesOut;
      }
    }
  }
  return [...rows.values()];
}
