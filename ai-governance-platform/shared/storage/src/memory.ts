import {
  applyChange, Change, checkChange, Collection, CollectionSpec, decodeToken, encodeToken, expired, inRange, Item, keyOf,
  Page, QueryOptions, RecordStore, StorageError,
} from './types';

/** Position of a record in a sorted listing: (sort value, partition key, sort key). */
type Cursor = [string, string, string];

const cmp = (a: Cursor, b: Cursor) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);

/** Sort, page and cut a list of records with their cursors. Shared logic for listings that aren't in a database. */
export function paginate<T>(rows: Array<{ cursor: Cursor; item: T }>, order: 'asc' | 'desc', limit: number | undefined, after?: string): Page<T> {
  const dir = order === 'desc' ? -1 : 1;
  rows.sort((a, b) => dir * cmp(a.cursor, b.cursor));
  let start = 0;
  if (after) {
    const c = decodeToken<Cursor>(after);
    start = rows.findIndex((r) => dir * cmp(r.cursor, c) > 0);
    if (start < 0) start = rows.length;
  }
  const n = limit && limit > 0 ? limit : rows.length;
  const page = rows.slice(start, start + n);
  const more = start + n < rows.length;
  return { items: page.map((r) => r.item), ...(more && page.length ? { next: encodeToken(page[page.length - 1].cursor) } : {}) };
}

class MemoryCollection<T extends object> implements Collection<T> {
  constructor(readonly spec: CollectionSpec, private rows: Map<string, Item>) {}

  private id(key: Item) {
    const { pk, sk } = keyOf(this.spec, key);
    return `${pk}\u0000${sk}`;
  }

  async get(key: Item) {
    const item = this.rows.get(this.id(key));
    return item && !expired(this.spec, item) ? (structuredClone(item) as T) : null;
  }

  async put(item: T, options: { ifNotExists?: boolean } = {}) {
    const id = this.id(item as Item);
    const existing = this.rows.get(id);
    if (options.ifNotExists && existing && !expired(this.spec, existing)) return false;
    this.rows.set(id, structuredClone(item) as Item);
    return true;
  }

  async update(key: Item, change: Change) {
    checkChange(this.spec, change);
    const id = this.id(key);
    const existing = this.rows.get(id);
    const live = existing && !expired(this.spec, existing) ? existing : undefined;
    if (change.ifExists && !live) return null;
    const { pk, sk } = keyOf(this.spec, key);
    const base: Item = live ?? { [this.spec.partitionKey]: pk, ...(this.spec.sortKey ? { [this.spec.sortKey]: sk } : {}) };
    const next = applyChange(base, change);
    this.rows.set(id, next);
    return structuredClone(next) as T;
  }

  async delete(key: Item) {
    this.rows.delete(this.id(key));
  }

  async query(o: QueryOptions): Promise<Page<T>> {
    const idx = o.index ? this.spec.indexes?.[o.index] : undefined;
    if (o.index && !idx) throw new StorageError(`${this.spec.name}: no index ${o.index}`);
    const pkField = idx ? idx.partitionKey : this.spec.partitionKey;
    const skField = idx ? idx.sortKey : this.spec.sortKey;
    const rows: Array<{ cursor: Cursor; item: T }> = [];
    for (const item of this.rows.values()) {
      if (item[pkField] !== o.partition || expired(this.spec, item)) continue;
      const sortValue = skField ? item[skField] : '';
      if (skField && typeof sortValue !== 'string') continue; // not in the index
      if (!inRange(sortValue as string, o.range)) continue;
      const { pk, sk } = keyOf(this.spec, item);
      rows.push({ cursor: [sortValue as string, pk, sk], item: structuredClone(item) as T });
    }
    return paginate(rows, o.order ?? 'asc', o.limit, o.after);
  }

  async scan(o: { limit?: number; after?: string } = {}): Promise<Page<T>> {
    const rows: Array<{ cursor: Cursor; item: T }> = [];
    for (const item of this.rows.values()) {
      if (expired(this.spec, item)) continue;
      const { pk, sk } = keyOf(this.spec, item);
      rows.push({ cursor: ['', pk, sk], item: structuredClone(item) as T });
    }
    return paginate(rows, 'asc', o.limit, o.after);
  }
}

/** Records kept in this process. For tests and local experiments; nothing survives a restart. */
export class MemoryStore implements RecordStore {
  readonly kind = 'memory' as const;
  private data = new Map<string, Map<string, Item>>();

  collection<T extends object = Item>(spec: CollectionSpec): Collection<T> {
    let rows = this.data.get(spec.name);
    if (!rows) this.data.set(spec.name, (rows = new Map()));
    return new MemoryCollection<T>(spec, rows);
  }

  async ping() {}
  async close() {}

  /** Empty every collection (tests). */
  clear() {
    this.data.clear();
  }
}
