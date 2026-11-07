import net from 'net';
import { randomBytes } from 'crypto';
import { collection } from '@ai-governance/storage';
import { SecretBackend } from '../services/provider-key.store';
import { secretBackend } from '../services/secret-store';
import { isPrivateAddress } from '../mcp/egress';
import { DestinationKind, DestinationSecrets } from './formats';
import { RecordChoice, ExportRecord } from './records';

/**
 * A company's log destinations. The address, tokens and headers live in the secret store (a Sumo Logic or
 * webhook address often carries a token in its path); the record keeps a display hint and where each record
 * type was last sent up to.
 */

export interface Cursor {
  /** Sort position read up to: an ISO time for decisions, a record key for activity. */
  after: string;
  /** Decision IDs at exactly `after`, already sent (several can share a millisecond). */
  ids?: string[];
}

export type Source = 'decisions' | 'activity';

export interface PendingBatch {
  batchId: string;
  source: Source;
  records: ExportRecord[];
  /** Where the source's cursor moves when this batch is delivered (or dead-lettered). */
  cursor: Cursor;
  attempts: number;
  firstAttemptAt: string;
  nextAttemptAt: number;
}

export interface Destination {
  tenantId: string;
  recordKey: string;
  destinationId: string;
  name: string;
  kind: DestinationKind;
  recordTypes: RecordChoice[];
  enabled: boolean;
  /** Host and a masked path, for display. */
  urlHint: string;
  secretRef: string;
  /** Last four characters of the token or signing secret. */
  secretHint?: string;
  /** otlp_http: names of the headers kept in the secret store (values never shown). */
  headerNames?: string[];
  splunkIndex?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  cursorDecisions: Cursor;
  cursorActivity: Cursor;
  pending?: PendingBatch;
  deliveredCount: number;
  deadLetterCount: number;
  lastDeliveredAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
  /** Which gateway is sending for this destination right now (`none` when free). */
  leaseId: string;
  leaseUntil: number;
}

export interface DeadLetter {
  tenantId: string;
  recordKey: string;
  entryId: string;
  destinationId: string;
  destinationName: string;
  source: Source;
  records: ExportRecord[];
  count: number;
  error: string;
  attempts: number;
  firstAttemptAt: string;
  lastAttemptAt: string;
  ttl: number;
}

export const DEAD_LETTER_DAYS = 30;
/** Sorts by time: `dl<epoch ms><random>`. Stored as `dead#<entryId>`. */
export const newDeadLetterId = () => `dl${Date.now()}${randomBytes(4).toString('hex')}`;
/** Index partition listing every destination, so the sender needn't scan. */
export const INDEX_PARTITION = '__log_export_index';
export const MAX_DESTINATIONS = 5;

export class DestinationError extends Error {
  constructor(message: string, readonly code = 'INVALID_DESTINATION') { super(message); }
}

const allowHttp = () => process.env.LOG_EXPORT_ALLOW_HTTP === 'true';
export const allowPrivateDestinations = () => process.env.LOG_EXPORT_ALLOW_PRIVATE_DESTINATIONS === 'true';

/** Check an address when an admin saves it. DNS is checked again on every connection. */
export function checkDestinationUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new DestinationError('That isn’t a valid address'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && allowHttp())) throw new DestinationError('The address must start with https://');
  if (u.username || u.password) throw new DestinationError('Put credentials in the token or header fields, not the address');
  if (u.hash) throw new DestinationError('The address can’t have a #fragment');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivateDestinations() && (host === 'localhost' || (net.isIP(host) && isPrivateAddress(host)))) {
    throw new DestinationError('Private addresses are only allowed for a self-hosted gateway');
  }
  return u;
}

export function urlHint(u: URL): string {
  const path = u.pathname.length > 1 ? (u.pathname.length > 24 ? `${u.pathname.slice(0, 16)}…` : u.pathname) : '';
  return `${u.protocol}//${u.host}${path}${u.search ? '?…' : ''}`;
}

export const newSigningSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

export class DestinationStore {
  private cache = new Map<string, { value: DestinationSecrets; until: number }>();
  private records = () => collection<Record<string, any>>('logExport');

  constructor(
    private backend: SecretBackend = secretBackend(),
    private prefix = `${process.env.PROVIDER_KEYS_SECRET_PREFIX || `probaline/${process.env.STAGE || 'dev'}/provider-keys`}/log-export`,
  ) {}

  async list(tenantId: string): Promise<Destination[]> {
    const page = await this.records().query({ partition: tenantId, range: { beginsWith: 'dest#' }, limit: 50 });
    return page.items as Destination[];
  }

  async get(tenantId: string, destinationId: string): Promise<Destination | null> {
    return (await this.records().get({ tenantId, recordKey: `dest#${destinationId}` })) as Destination | null;
  }

  /** Every destination of every tenant: (tenantId, destinationId) pairs. */
  async all(): Promise<Array<{ tenantId: string; destinationId: string }>> {
    const out: Array<{ tenantId: string; destinationId: string }> = [];
    let after: string | undefined;
    do {
      const page = await this.records().query({ partition: INDEX_PARTITION, limit: 500, after });
      for (const i of page.items) out.push({ tenantId: i.forTenant, destinationId: i.destinationId });
      after = page.next;
    } while (after);
    return out;
  }

  async create(d: Destination, secrets: DestinationSecrets): Promise<Destination> {
    d.secretRef = await this.backend.put(this.secretName(d.tenantId, d.destinationId), JSON.stringify(secrets), { tenantId: d.tenantId, destinationId: d.destinationId, kind: 'log-export' });
    this.cache.set(d.secretRef, { value: secrets, until: Date.now() + 5 * 60_000 });
    await this.records().put(d as unknown as Record<string, any>);
    await this.records().put({ tenantId: INDEX_PARTITION, recordKey: `${d.tenantId}#${d.destinationId}`, forTenant: d.tenantId, destinationId: d.destinationId });
    return d;
  }

  async saveSecrets(d: Destination, secrets: DestinationSecrets): Promise<string> {
    const ref = await this.backend.put(this.secretName(d.tenantId, d.destinationId), JSON.stringify(secrets), { tenantId: d.tenantId, destinationId: d.destinationId, kind: 'log-export' });
    this.cache.set(ref, { value: secrets, until: Date.now() + 5 * 60_000 });
    return ref;
  }

  async secrets(d: Pick<Destination, 'secretRef'>): Promise<DestinationSecrets> {
    const c = this.cache.get(d.secretRef);
    if (c && c.until > Date.now()) return c.value;
    const value = JSON.parse(await this.backend.get(d.secretRef)) as DestinationSecrets;
    this.cache.set(d.secretRef, { value, until: Date.now() + 5 * 60_000 });
    return value;
  }

  async update(tenantId: string, destinationId: string, change: { set?: Record<string, unknown>; remove?: string[]; increment?: Record<string, number>; where?: Record<string, string> }): Promise<Destination | null> {
    return (await this.records().update({ tenantId, recordKey: `dest#${destinationId}` }, { ...change, ifExists: true })) as Destination | null;
  }

  async remove(d: Destination): Promise<void> {
    await this.records().delete({ tenantId: d.tenantId, recordKey: d.recordKey });
    await this.records().delete({ tenantId: INDEX_PARTITION, recordKey: `${d.tenantId}#${d.destinationId}` });
    this.cache.delete(d.secretRef);
    await this.backend.delete(d.secretRef).catch(() => undefined);
  }

  // ── Dead letters ────────────────────────────────────────────────────────────────────────────

  async addDeadLetter(dl: DeadLetter): Promise<void> {
    await this.records().put(dl as unknown as Record<string, any>);
  }

  async deadLetters(tenantId: string, limit = 50): Promise<DeadLetter[]> {
    const page = await this.records().query({ partition: tenantId, range: { beginsWith: 'dead#' }, order: 'desc', limit });
    return page.items as DeadLetter[];
  }

  async deadLetter(tenantId: string, entryId: string): Promise<DeadLetter | null> {
    return (await this.records().get({ tenantId, recordKey: `dead#${entryId}` })) as DeadLetter | null;
  }

  async removeDeadLetter(dl: Pick<DeadLetter, 'tenantId' | 'recordKey'>): Promise<void> {
    await this.records().delete({ tenantId: dl.tenantId, recordKey: dl.recordKey });
  }

  async updateDeadLetter(dl: Pick<DeadLetter, 'tenantId' | 'recordKey'>, set: Record<string, unknown>, increment?: Record<string, number>): Promise<void> {
    await this.records().update({ tenantId: dl.tenantId, recordKey: dl.recordKey }, { set, increment, ifExists: true });
  }

  private secretName(tenantId: string, destinationId: string) {
    return `${this.prefix}/${tenantId}/${destinationId}`;
  }
}

let shared: DestinationStore | null = null;
export function destinationStore(): DestinationStore {
  if (!shared) shared = new DestinationStore();
  return shared;
}
export function setDestinationStore(store: DestinationStore | null) {
  shared = store;
}
