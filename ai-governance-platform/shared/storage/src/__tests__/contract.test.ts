/**
 * One behaviour, every backend. Memory always runs; PostgreSQL runs when PG_TEST_URL is set and DynamoDB
 * when DYNAMO_TEST_ENDPOINT is set (LocalStack), e.g.
 *   PG_TEST_URL=postgres://probaline:probaline-dev@localhost:5433/probaline DYNAMO_TEST_ENDPOINT=http://localhost:4566 npm test -w shared/storage
 */
import { randomBytes } from 'crypto';
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoStore, MemoryStore, PostgresStore } from '../index';
import { CollectionSpec, Item, RecordStore } from '../types';

const run = randomBytes(3).toString('hex');
const SPECS = {
  plain: { name: 'ct_plain', table: `ct-${run}-plain`, partitionKey: 'id' } as CollectionSpec,
  sorted: {
    name: 'ct_sorted', table: `ct-${run}-sorted`, partitionKey: 'tenantId', sortKey: 'itemId', ttlField: 'ttl',
    indexes: { 'byTime': { partitionKey: 'tenantId', sortKey: 'timestamp' }, 'byHash': { partitionKey: 'hash' } },
  } as CollectionSpec,
};

type Backend = { name: string; make: () => Promise<RecordStore>; done?: () => Promise<void> };
const backends: Backend[] = [{ name: 'memory', make: async () => new MemoryStore() }];

if (process.env.PG_TEST_URL) {
  backends.push({
    name: 'postgres',
    make: async () => new PostgresStore({ connectionString: process.env.PG_TEST_URL, tablePrefix: `ct${run}_`, purgeEverySeconds: 0 }),
  });
}

if (process.env.DYNAMO_TEST_ENDPOINT) {
  const client = new DynamoDBClient({ region: 'us-east-1', endpoint: process.env.DYNAMO_TEST_ENDPOINT, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  backends.push({
    name: 'dynamodb',
    make: async () => {
      const s = (n: string) => ({ AttributeName: n, AttributeType: 'S' as const });
      await client.send(new CreateTableCommand({
        TableName: SPECS.plain.table, BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }], AttributeDefinitions: [s('id')],
      }));
      await client.send(new CreateTableCommand({
        TableName: SPECS.sorted.table, BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [{ AttributeName: 'tenantId', KeyType: 'HASH' }, { AttributeName: 'itemId', KeyType: 'RANGE' }],
        AttributeDefinitions: [s('tenantId'), s('itemId'), s('timestamp'), s('hash')],
        GlobalSecondaryIndexes: [
          { IndexName: 'byTime', KeySchema: [{ AttributeName: 'tenantId', KeyType: 'HASH' }, { AttributeName: 'timestamp', KeyType: 'RANGE' }], Projection: { ProjectionType: 'ALL' } },
          { IndexName: 'byHash', KeySchema: [{ AttributeName: 'hash', KeyType: 'HASH' }], Projection: { ProjectionType: 'ALL' } },
        ],
      }));
      return new DynamoStore({ endpoint: process.env.DYNAMO_TEST_ENDPOINT, region: 'us-east-1' });
    },
    done: async () => {
      for (const t of [SPECS.plain.table, SPECS.sorted.table]) await client.send(new DeleteTableCommand({ TableName: t })).catch(() => undefined);
    },
  });
}

describe.each(backends)('$name backend', (backend) => {
  let store: RecordStore;
  beforeAll(async () => { store = await backend.make(); }, 30_000);
  afterAll(async () => {
    if (store instanceof PostgresStore) {
      for (const n of ['ct_plain', 'ct_sorted']) await store.pool.query(`DROP TABLE IF EXISTS "ct${run}_${n}"`);
    }
    await store?.close();
    await backend.done?.();
  });

  const plain = () => store.collection(SPECS.plain);
  const sorted = () => store.collection(SPECS.sorted);
  // Each test uses its own tenant, so tests don't see each other's records.
  let tenant = 0;
  const t = () => `t${run}-${++tenant}`;

  it('puts and gets whole records, with nested values intact', async () => {
    const item = { id: `a-${run}`, name: 'Acme', settings: { mode: 'closed', list: [1, 2] }, active: true, n: 3.5, none: null };
    expect(await plain().put(item)).toBe(true);
    expect(await plain().get({ id: item.id })).toEqual(item);
    expect(await plain().get({ id: 'missing' })).toBeNull();
  });

  it('only writes when new, if asked', async () => {
    const id = `b-${run}`;
    expect(await plain().put({ id, v: 1 }, { ifNotExists: true })).toBe(true);
    expect(await plain().put({ id, v: 2 }, { ifNotExists: true })).toBe(false);
    expect(await plain().get({ id })).toEqual({ id, v: 1 });
    expect(await plain().put({ id, v: 3 })).toBe(true);
    expect((await plain().get({ id }))?.v).toBe(3);
  });

  it('updates fields: set, nested set, remove and increment, returning the new record', async () => {
    const id = `c-${run}`;
    await plain().put({ id, name: 'x', old: 'gone', settings: { keep: 1 } });
    const out = await plain().update({ id }, {
      set: { name: 'y', 'settings.mode': 'open', 'extra.a': 'b' }, remove: ['old', 'settings.keep'], increment: { count: 2 },
    });
    expect(out).toEqual({ id, name: 'y', settings: { mode: 'open' }, extra: { a: 'b' }, count: 2 });
    expect(await plain().update({ id }, { increment: { count: 3 } })).toMatchObject({ count: 5 });
    expect(await plain().get({ id })).toEqual({ id, name: 'y', settings: { mode: 'open' }, extra: { a: 'b' }, count: 5 });
  });

  it('creates the record on update unless told it must exist', async () => {
    expect(await plain().update({ id: `d-${run}` }, { set: { v: 1 } })).toEqual({ id: `d-${run}`, v: 1 });
    expect(await plain().update({ id: `e-${run}` }, { set: { v: 1 }, ifExists: true })).toBeNull();
    expect(await plain().get({ id: `e-${run}` })).toBeNull();
    expect(await plain().update({ id: `d-${run}` }, { set: { 'nested.v': 2 }, ifExists: true })).toEqual({ id: `d-${run}`, v: 1, nested: { v: 2 } });
  });

  it('refuses to change key fields or unsafe paths', async () => {
    await expect(plain().update({ id: 'z' }, { set: { id: 'other' } })).rejects.toThrow(/key field/);
    await expect(plain().update({ id: 'z' }, { set: { "a'; drop": 1 } })).rejects.toThrow(/Unsupported field path/);
    await expect(plain().update({ id: 'z' }, { set: { 'a.b.c': 1 } })).rejects.toThrow(/Unsupported field path/);
  });

  it('deletes', async () => {
    await plain().put({ id: `f-${run}` });
    await plain().delete({ id: `f-${run}` });
    expect(await plain().get({ id: `f-${run}` })).toBeNull();
  });

  it('queries a partition by sort key ranges, in either order', async () => {
    const tn = t();
    for (const k of ['a1', 'a2', 'b1', 'b2', 'c1']) await sorted().put({ tenantId: tn, itemId: k });
    await sorted().put({ tenantId: t(), itemId: 'a1' }); // another partition
    const ids = async (o: object) => (await sorted().query({ partition: tn, ...o })).items.map((i) => i.itemId);
    expect(await ids({})).toEqual(['a1', 'a2', 'b1', 'b2', 'c1']);
    expect(await ids({ order: 'desc' })).toEqual(['c1', 'b2', 'b1', 'a2', 'a1']);
    expect(await ids({ range: { beginsWith: 'b' } })).toEqual(['b1', 'b2']);
    expect(await ids({ range: { between: ['a2', 'b2'] } })).toEqual(['a2', 'b1', 'b2']);
    expect(await ids({ range: { gte: 'b2' } })).toEqual(['b2', 'c1']);
    expect(await ids({ range: { lt: 'a2' } })).toEqual(['a1']);
  });

  it('pages through results without gaps or repeats', async () => {
    const tn = t();
    const all = Array.from({ length: 23 }, (_, i) => `k${String(i).padStart(2, '0')}`);
    for (const k of all) await sorted().put({ tenantId: tn, itemId: k });
    for (const order of ['asc', 'desc'] as const) {
      const seen: string[] = [];
      let after: string | undefined;
      do {
        const page = await sorted().query({ partition: tn, order, limit: 5, after });
        seen.push(...page.items.map((i) => i.itemId as string));
        after = page.next;
      } while (after);
      expect(seen).toEqual(order === 'asc' ? all : [...all].reverse());
    }
  });

  it('queries a secondary index with a sort key, skipping records without the field', async () => {
    const tn = t();
    const times = ['2026-11-01T10:00:00Z', '2026-11-02T10:00:00Z', '2026-11-03T10:00:00Z', '2026-11-04T10:00:00Z'];
    for (const [i, ts] of times.entries()) await sorted().put({ tenantId: tn, itemId: `r${i}`, timestamp: ts });
    await sorted().put({ tenantId: tn, itemId: 'no-time' });
    const page = await sorted().query({ partition: tn, index: 'byTime', range: { between: ['2026-11-02', '2026-11-03T23:59:59Z'] }, order: 'desc' });
    expect(page.items.map((i) => i.itemId)).toEqual(['r2', 'r1']);
    const everything = await sorted().query({ partition: tn, index: 'byTime' });
    expect(everything.items).toHaveLength(4);
  });

  it('looks records up by an index without a sort key', async () => {
    const tn = t();
    const hash = `h-${run}-${tn}`;
    await sorted().put({ tenantId: tn, itemId: 'k1', hash });
    await sorted().put({ tenantId: tn, itemId: 'k2', hash: 'other' });
    const page = await sorted().query({ partition: hash, index: 'byHash' });
    expect(page.items).toEqual([{ tenantId: tn, itemId: 'k1', hash }]);
  });

  it('hides expired records, and lets a new one replace them', async () => {
    const tn = t();
    const past = Math.floor(Date.now() / 1000) - 60;
    const future = Math.floor(Date.now() / 1000) + 3600;
    await sorted().put({ tenantId: tn, itemId: 'old', ttl: past });
    await sorted().put({ tenantId: tn, itemId: 'new', ttl: future });
    expect(await sorted().get({ tenantId: tn, itemId: 'old' })).toBeNull();
    expect((await sorted().query({ partition: tn })).items.map((i) => i.itemId)).toEqual(['new']);
    expect(await sorted().put({ tenantId: tn, itemId: 'old', ttl: future }, { ifNotExists: true })).toBe(true);
    expect(await sorted().get({ tenantId: tn, itemId: 'old' })).toMatchObject({ ttl: future });
    if (store instanceof PostgresStore) {
      await sorted().put({ tenantId: tn, itemId: 'purge-me', ttl: past });
      expect(await store.purgeExpired()).toBeGreaterThanOrEqual(1);
    }
  });

  it('scans every record a page at a time', async () => {
    const seen = new Set<string>();
    let after: string | undefined;
    let pages = 0;
    do {
      const page = await plain().scan({ limit: 2, after });
      for (const i of page.items as Item[]) seen.add(i.id as string);
      after = page.next;
      pages++;
    } while (after && pages < 50);
    for (const id of [`a-${run}`, `b-${run}`, `c-${run}`, `d-${run}`]) expect(seen.has(id)).toBe(true);
  });

  it('answers a health check', async () => {
    await expect(store.ping()).resolves.toBeUndefined();
  });
});
