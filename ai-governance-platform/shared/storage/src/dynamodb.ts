import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  Change, checkChange, Collection, CollectionSpec, decodeToken, encodeToken, expired, fieldPath, Item, keyOf, Page,
  QueryOptions, Range, RecordStore, StorageError,
} from './types';

const isConditionFailure = (err: unknown) => (err as { name?: string })?.name === 'ConditionalCheckFailedException';

function rangeExpression(field: string, range: Range, names: Record<string, string>, values: Record<string, unknown>): string {
  names['#sk'] = field;
  if ('between' in range) { values[':r1'] = range.between[0]; values[':r2'] = range.between[1]; return '#sk BETWEEN :r1 AND :r2'; }
  if ('beginsWith' in range) { values[':r1'] = range.beginsWith; return 'begins_with(#sk, :r1)'; }
  const [op, v] = 'gte' in range ? ['>=', range.gte] : 'lte' in range ? ['<=', range.lte] : 'gt' in range ? ['>', range.gt] : ['<', range.lt];
  values[':r1'] = v;
  return `#sk ${op} :r1`;
}

class DynamoCollection<T extends object> implements Collection<T> {
  constructor(readonly spec: CollectionSpec, private db: DynamoDBDocumentClient) {}

  private key(item: Item): Item {
    const { pk, sk } = keyOf(this.spec, item);
    return { [this.spec.partitionKey]: pk, ...(this.spec.sortKey ? { [this.spec.sortKey]: sk } : {}) };
  }

  async get(key: Item) {
    const r = await this.db.send(new GetCommand({ TableName: this.spec.table, Key: this.key(key) }));
    const item = r.Item as Item | undefined;
    return item && !expired(this.spec, item) ? (item as T) : null;
  }

  async put(item: T, options: { ifNotExists?: boolean } = {}) {
    keyOf(this.spec, item as Item);
    try {
      await this.db.send(new PutCommand({
        TableName: this.spec.table,
        Item: item,
        // DynamoDB deletes expired records some time after they expire; until then they count as gone.
        ...(options.ifNotExists
          ? this.spec.ttlField
            ? {
              ConditionExpression: 'attribute_not_exists(#pk) OR #ttl <= :now',
              ExpressionAttributeNames: { '#pk': this.spec.partitionKey, '#ttl': this.spec.ttlField },
              ExpressionAttributeValues: { ':now': Math.floor(Date.now() / 1000) },
            }
            : { ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': this.spec.partitionKey } }
          : {}),
      }));
      return true;
    } catch (err) {
      if (options.ifNotExists && isConditionFailure(err)) return false;
      throw err;
    }
  }

  async update(key: Item, change: Change) {
    checkChange(this.spec, change);
    const Key = this.key(key);
    const conditional = !!(change.ifExists || change.where);
    // Names must all be used by the expressions, so the key name is declared only for the condition.
    const conditionParts = (names: Record<string, string>, values: Record<string, unknown>) => {
      names['#pk'] = this.spec.partitionKey;
      const parts = ['attribute_exists(#pk)'];
      Object.entries(change.where ?? {}).forEach(([f, v], n) => {
        names[`#w${n}`] = f;
        values[`:w${n}`] = v;
        parts.push(`#w${n} = :w${n}`);
      });
      return parts.join(' AND ');
    };
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const condition = conditional ? conditionParts(names, values) : undefined;
    const nameOf = (field: string) => {
      const existing = Object.entries(names).find(([k, v]) => v === field && k.startsWith('#f'));
      if (existing) return existing[0];
      const n = `#f${Object.keys(names).length}`;
      names[n] = field;
      return n;
    };

    // DynamoDB can't set a.b when a is missing, and can't touch a and a.b in one update: create parents first.
    const parents = [...new Set(Object.keys(change.set ?? {}).map(fieldPath).filter((p) => p.length === 2).map((p) => p[0]))];
    for (const parent of parents) {
      try {
        await this.db.send(new UpdateCommand({
          TableName: this.spec.table, Key,
          ...(() => {
            const n: Record<string, string> = { '#p': parent };
            const v: Record<string, unknown> = { ':empty': {} };
            const c = conditional ? conditionParts(n, v) : undefined;
            return { UpdateExpression: 'SET #p = if_not_exists(#p, :empty)', ExpressionAttributeNames: n, ExpressionAttributeValues: v, ...(c ? { ConditionExpression: c } : {}) };
          })(),
        }));
      } catch (err) {
        if (isConditionFailure(err)) return null;
        throw err;
      }
    }

    const sets: string[] = [];
    let i = 0;
    for (const [path, value] of Object.entries(change.set ?? {})) {
      const v = `:v${i++}`;
      values[v] = value;
      sets.push(`${fieldPath(path).map(nameOf).join('.')} = ${v}`);
    }
    for (const [field, n] of Object.entries(change.increment ?? {})) {
      const v = `:v${i++}`;
      values[v] = n;
      values[':zero'] = 0;
      const f = nameOf(field);
      sets.push(`${f} = if_not_exists(${f}, :zero) + ${v}`);
    }
    const removes = (change.remove ?? []).map((p) => fieldPath(p).map(nameOf).join('.'));
    const parts = [sets.length ? `SET ${sets.join(', ')}` : '', removes.length ? `REMOVE ${removes.join(', ')}` : ''].filter(Boolean);
    if (parts.length === 0) {
      // Nothing to change: like the other backends, an unconditional update still creates the record.
      const existing = await this.get(key);
      if (change.where && existing && Object.entries(change.where).some(([f, v]) => (existing as Item)[f] !== v)) return null;
      if (existing || condition) return existing;
      await this.put(Key as T);
      return this.get(key);
    }
    try {
      const r = await this.db.send(new UpdateCommand({
        TableName: this.spec.table, Key,
        UpdateExpression: parts.join(' '),
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
        ...(condition ? { ConditionExpression: condition } : {}),
        ReturnValues: 'ALL_NEW',
      }));
      return (r.Attributes ?? null) as T | null;
    } catch (err) {
      if (isConditionFailure(err)) return null;
      throw err;
    }
  }

  async delete(key: Item) {
    await this.db.send(new DeleteCommand({ TableName: this.spec.table, Key: this.key(key) }));
  }

  async query(o: QueryOptions): Promise<Page<T>> {
    const idx = o.index ? this.spec.indexes?.[o.index] : undefined;
    if (o.index && !idx) throw new StorageError(`${this.spec.name}: no index ${o.index}`);
    const pkField = idx ? idx.partitionKey : this.spec.partitionKey;
    const skField = idx ? idx.sortKey : this.spec.sortKey;
    const names: Record<string, string> = { '#p': pkField };
    const values: Record<string, unknown> = { ':p': o.partition };
    let cond = '#p = :p';
    if (o.range) {
      if (!skField) throw new StorageError(`${this.spec.name}: a range needs a sort key`);
      cond += ` AND ${rangeExpression(skField, o.range, names, values)}`;
    }
    const r = await this.db.send(new QueryCommand({
      TableName: this.spec.table,
      ...(o.index ? { IndexName: o.index } : {}),
      KeyConditionExpression: cond,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ScanIndexForward: (o.order ?? 'asc') === 'asc',
      ...(o.limit ? { Limit: o.limit } : {}),
      ...(o.after ? { ExclusiveStartKey: decodeToken<Item>(o.after) } : {}),
    }));
    const items = ((r.Items ?? []) as Item[]).filter((it) => !expired(this.spec, it)) as T[];
    return { items, ...(r.LastEvaluatedKey ? { next: encodeToken(r.LastEvaluatedKey) } : {}) };
  }

  async scan(o: { limit?: number; after?: string } = {}): Promise<Page<T>> {
    const r = await this.db.send(new ScanCommand({
      TableName: this.spec.table,
      ...(o.limit ? { Limit: o.limit } : {}),
      ...(o.after ? { ExclusiveStartKey: decodeToken<Item>(o.after) } : {}),
    }));
    const items = ((r.Items ?? []) as Item[]).filter((it) => !expired(this.spec, it)) as T[];
    return { items, ...(r.LastEvaluatedKey ? { next: encodeToken(r.LastEvaluatedKey) } : {}) };
  }
}

/** DynamoDB, with the same tables and indexes the AWS deployment creates. */
export class DynamoStore implements RecordStore {
  readonly kind = 'dynamodb' as const;
  private db: DynamoDBDocumentClient;

  constructor(options: { region?: string; endpoint?: string; client?: DynamoDBDocumentClient } = {}) {
    this.db = options.client ?? DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: options.region ?? process.env.AWS_REGION ?? 'us-east-1', ...(options.endpoint ? { endpoint: options.endpoint } : {}) }),
      { marshallOptions: { removeUndefinedValues: true } },
    );
  }

  collection<T extends object = Item>(spec: CollectionSpec): Collection<T> {
    return new DynamoCollection<T>(spec, this.db);
  }

  async ping(spec?: CollectionSpec) {
    // Describing a table the service uses proves the endpoint, the credentials and that table, with only the
    // permissions the service already has (listing tables would need access to every table in the account).
    if (spec) {
      const { DescribeTableCommand } = await import('@aws-sdk/client-dynamodb');
      await this.db.send(new DescribeTableCommand({ TableName: spec.table }) as never);
      return;
    }
    const { ListTablesCommand } = await import('@aws-sdk/client-dynamodb');
    await this.db.send(new ListTablesCommand({ Limit: 1 }) as never);
  }

  async close() {
    this.db.destroy();
  }
}
