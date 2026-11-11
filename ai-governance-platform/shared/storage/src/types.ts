/**
 * Records, stored the same way on every backend.
 *
 * A collection holds records identified by a partition key and an optional sort key (both strings). It can
 * declare secondary indexes (look records up by other string fields) and an expiry field (epoch seconds;
 * expired records are deleted in the background). This is the subset of DynamoDB that Probaline uses, so
 * the DynamoDB backend maps one to one and the PostgreSQL backend can implement it exactly.
 */

export type Item = Record<string, unknown>;

export interface IndexSpec {
  partitionKey: string;
  sortKey?: string;
}

export interface CollectionSpec {
  /** Logical name, used for the PostgreSQL table: lower case, digits and underscores. */
  name: string;
  /** DynamoDB table name. */
  table: string;
  partitionKey: string;
  sortKey?: string;
  indexes?: Record<string, IndexSpec>;
  /** Field holding an expiry time in epoch seconds. */
  ttlField?: string;
}

/** A condition on the sort key (of the table or of the index being queried). Values are compared as strings. */
export type Range =
  | { between: [string, string] }
  | { beginsWith: string }
  | { gte: string }
  | { lte: string }
  | { gt: string }
  | { lt: string };

export interface QueryOptions {
  /** Value of the partition key (of the index, when `index` is set). */
  partition: string;
  index?: string;
  range?: Range;
  order?: 'asc' | 'desc';
  limit?: number;
  /** The `next` token from the previous page. */
  after?: string;
}

export interface Page<T> {
  items: T[];
  /** Pass as `after` to read the next page; absent on the last page. */
  next?: string;
}

/**
 * A change to one record. Field paths may be nested one level (`settings.secretsAction`); the parent is
 * created when missing. Key fields can't be changed.
 */
export interface Change {
  set?: Record<string, unknown>;
  remove?: string[];
  /** Add to numeric fields (a missing field counts as 0). */
  increment?: Record<string, number>;
  /** Only change a record that already exists; otherwise nothing is written and `update` returns null. */
  ifExists?: boolean;
  /**
   * Only change the record if these top-level fields currently hold these values (compared as strings).
   * Implies ifExists. Used to move a record from one state to the next exactly once (e.g. pending → approved).
   */
  where?: Record<string, string>;
}

export interface Collection<T extends object = Item> {
  readonly spec: CollectionSpec;
  get(key: Item): Promise<T | null>;
  /** Write a whole record. With `ifNotExists`, returns false (and writes nothing) if it already exists. */
  put(item: T, options?: { ifNotExists?: boolean }): Promise<boolean>;
  /** Change fields in place and return the record as it now is; null when `ifExists` and it doesn't exist. */
  update(key: Item, change: Change): Promise<T | null>;
  delete(key: Item): Promise<void>;
  query(options: QueryOptions): Promise<Page<T>>;
  /** Every record, a page at a time, in no particular order. */
  scan(options?: { limit?: number; after?: string }): Promise<Page<T>>;
}

export type BackendKind = 'dynamodb' | 'postgres' | 'memory';

export interface RecordStore {
  readonly kind: BackendKind;
  collection<T extends object = Item>(spec: CollectionSpec): Collection<T>;
  /**
   * Throws if the store can't be reached. Used by health checks. Pass a collection the service can read: on
   * DynamoDB that table is described, which the service's read permission covers.
   */
  ping(spec?: CollectionSpec): Promise<void>;
  close(): Promise<void>;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

const FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Split and check a field path: one or two safe identifiers. */
export function fieldPath(path: string): string[] {
  const parts = path.split('.');
  if (parts.length > 2 || !parts.every((p) => FIELD.test(p))) throw new StorageError(`Unsupported field path: ${path}`);
  return parts;
}

/** The key fields of a record, checked to be present strings. */
export function keyOf(spec: CollectionSpec, item: Item): { pk: string; sk: string } {
  const pk = item[spec.partitionKey];
  if (typeof pk !== 'string' || !pk) throw new StorageError(`${spec.name}: ${spec.partitionKey} must be a non-empty string`);
  if (!spec.sortKey) return { pk, sk: '' };
  const sk = item[spec.sortKey];
  if (typeof sk !== 'string' || !sk) throw new StorageError(`${spec.name}: ${spec.sortKey} must be a non-empty string`);
  return { pk, sk };
}

/** Check a change doesn't touch key fields, and that every path is valid. */
export function checkChange(spec: CollectionSpec, change: Change) {
  const keys = new Set([spec.partitionKey, spec.sortKey].filter(Boolean) as string[]);
  const paths = [...Object.keys(change.set ?? {}), ...(change.remove ?? []), ...Object.keys(change.increment ?? {})];
  for (const p of paths) {
    const parts = fieldPath(p);
    if (keys.has(parts[0])) throw new StorageError(`${spec.name}: key field ${parts[0]} can't be changed`);
  }
  for (const f of Object.keys(change.where ?? {})) {
    if (fieldPath(f).length !== 1) throw new StorageError(`${spec.name}: conditions are on top-level fields only`);
    if (typeof change.where![f] !== 'string') throw new StorageError(`${spec.name}: condition values must be strings`);
  }
  for (const [f, n] of Object.entries(change.increment ?? {})) {
    if (fieldPath(f).length !== 1) throw new StorageError(`${spec.name}: only top-level fields can be incremented`);
    if (!Number.isFinite(n)) throw new StorageError(`${spec.name}: increment for ${f} must be a number`);
  }
}

export function encodeToken(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeToken<T>(token: string): T {
  try {
    return JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as T;
  } catch {
    throw new StorageError('Invalid page token');
  }
}

/** Whether a sort value satisfies a range. Plain string comparison, as DynamoDB and `COLLATE "C"` do. */
export function inRange(value: string | undefined, range?: Range): boolean {
  if (!range) return true;
  if (value === undefined) return false;
  if ('between' in range) return value >= range.between[0] && value <= range.between[1];
  if ('beginsWith' in range) return value.startsWith(range.beginsWith);
  if ('gte' in range) return value >= range.gte;
  if ('lte' in range) return value <= range.lte;
  if ('gt' in range) return value > range.gt;
  return value < range.lt;
}

/** Apply a change to a plain object (used by the memory backend, and to describe the semantics). */
export function applyChange(item: Item, change: Change): Item {
  const out: Item = structuredClone(item);
  for (const [path, value] of Object.entries(change.set ?? {})) {
    const [a, b] = fieldPath(path);
    if (b === undefined) out[a] = structuredClone(value);
    else {
      const parent = out[a] && typeof out[a] === 'object' && !Array.isArray(out[a]) ? (out[a] as Item) : {};
      out[a] = { ...parent, [b]: structuredClone(value) };
    }
  }
  for (const [f, n] of Object.entries(change.increment ?? {})) out[f] = (Number(out[f]) || 0) + n;
  for (const path of change.remove ?? []) {
    const [a, b] = fieldPath(path);
    if (b === undefined) delete out[a];
    else if (out[a] && typeof out[a] === 'object') delete (out[a] as Item)[b];
  }
  return out;
}

/** True when the record's expiry time has passed. */
export function expired(spec: CollectionSpec, item: Item, nowSeconds = Date.now() / 1000): boolean {
  if (!spec.ttlField) return false;
  const t = Number(item[spec.ttlField]);
  return Number.isFinite(t) && t > 0 && t <= nowSeconds;
}

/** Read every page of a query or scan, up to `max` records. */
export async function allPages<T>(read: (after?: string) => Promise<Page<T>>, max = 10_000): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  do {
    const page = await read(after);
    out.push(...page.items);
    after = page.next;
  } while (after && out.length < max);
  return out.slice(0, max);
}
