import { S3Client } from '@aws-sdk/client-s3';
import { DynamoStore } from './dynamodb';
import { MemoryStore } from './memory';
import { FileObjectStore, MemoryObjectStore, ObjectStore, S3ObjectStore } from './objects';
import { PostgresStore } from './postgres';
import { Collection, CollectionSpec, Item, RecordStore, StorageError } from './types';

export * from './types';
export { DynamoStore } from './dynamodb';
export { MemoryStore, paginate } from './memory';
export { PostgresStore } from './postgres';
export type { PostgresOptions } from './postgres';
export { FileObjectStore, MemoryObjectStore, S3ObjectStore } from './objects';
export type { ObjectStore } from './objects';

const env = (name: string, fallback: string) => process.env[name] || fallback;

/**
 * Every collection Probaline stores. DynamoDB table names come from the same settings (and defaults) the
 * services have always used; PostgreSQL tables are named after the collection.
 */
export const SPECS = {
  tenants: (): CollectionSpec => ({ name: 'tenants', table: env('TENANTS_TABLE', 'ai-gov-tenants-dev'), partitionKey: 'tenantId' }),
  policies: (): CollectionSpec => ({ name: 'policies', table: env('POLICIES_TABLE', 'ai-governance-policies'), partitionKey: 'tenantId', sortKey: 'policyId' }),
  compliance: (): CollectionSpec => ({ name: 'compliance', table: env('COMPLIANCE_TABLE', 'ai-gov-compliance-dev'), partitionKey: 'tenantId', sortKey: 'framework' }),
  models: (): CollectionSpec => ({ name: 'models', table: env('MODELS_TABLE', 'ai-gov-models-dev'), partitionKey: 'tenantId', sortKey: 'modelConfigId' }),
  apiKeys: (): CollectionSpec => ({
    name: 'api_keys', table: env('API_KEYS_TABLE', 'ai-gov-api-keys-dev'), partitionKey: 'tenantId', sortKey: 'keyId',
    indexes: { 'keyHash-index': { partitionKey: 'keyHash' } },
  }),
  alerts: (): CollectionSpec => ({ name: 'alerts', table: env('ALERTS_TABLE', 'ai-gov-alerts-dev'), partitionKey: 'tenantId', sortKey: 'ruleId' }),
  shadowAi: (): CollectionSpec => ({ name: 'shadow_ai', table: env('SHADOW_AI_TABLE', 'ai-gov-shadow-ai-dev'), partitionKey: 'tenantId', sortKey: 'eventId', ttlField: 'ttl' }),
  auditLogs: (): CollectionSpec => ({
    name: 'audit_logs', table: env('AUDIT_LOGS_TABLE', 'ai-gov-audit-logs-dev'), partitionKey: 'tenantId', sortKey: 'requestId', ttlField: 'ttl',
    indexes: { 'tenantId-timestamp-index': { partitionKey: 'tenantId', sortKey: 'timestamp' } },
  }),
  metrics: (): CollectionSpec => ({ name: 'metrics', table: env('METRICS_TABLE', 'ai-governance-metrics'), partitionKey: 'tenantId', sortKey: 'period', ttlField: 'ttl' }),
  /** MCP servers created from the dashboard (one record each). */
  mcpServers: (): CollectionSpec => ({ name: 'mcp_servers', table: env('MCP_SERVERS_TABLE', 'ai-gov-mcp-servers-dev'), partitionKey: 'tenantId', sortKey: 'serverId' }),
  /** Backend APIs added to MCP servers. */
  mcpApis: (): CollectionSpec => ({ name: 'mcp_apis', table: env('MCP_APIS_TABLE', 'ai-gov-mcp-apis-dev'), partitionKey: 'tenantId', sortKey: 'apiId' }),
  /** Tools, keyed `<serverId>#<toolName>` so a server's tools are one prefix query. */
  mcpTools: (): CollectionSpec => ({ name: 'mcp_tools', table: env('MCP_TOOLS_TABLE', 'ai-gov-mcp-tools-dev'), partitionKey: 'tenantId', sortKey: 'toolKey' }),
  /** Published versions of each MCP server, keyed `<serverId>#v<000001>`: what agents see. */
  mcpVersions: (): CollectionSpec => ({ name: 'mcp_versions', table: env('MCP_VERSIONS_TABLE', 'ai-gov-mcp-versions-dev'), partitionKey: 'tenantId', sortKey: 'versionKey' }),
  /** Requests to run write tools that need a person's approval, keyed `<fingerprint>-<id>`. */
  mcpApprovals: (): CollectionSpec => ({ name: 'mcp_approvals', table: env('MCP_APPROVALS_TABLE', 'ai-gov-mcp-approvals-dev'), partitionKey: 'tenantId', sortKey: 'approvalId', ttlField: 'ttl' }),
  /** People signing in to MCP servers: identity-provider settings, OAuth clients, pending sign-ins, codes and refresh tokens. */
  mcpOauth: (): CollectionSpec => ({ name: 'mcp_oauth', table: env('MCP_OAUTH_TABLE', 'ai-gov-mcp-oauth-dev'), partitionKey: 'tenantId', sortKey: 'recordKey', ttlField: 'ttl' }),
  /** Connectors in companies' networks, and the calls waiting for them. */
  mcpConnectors: (): CollectionSpec => ({ name: 'mcp_connectors', table: env('MCP_CONNECTORS_TABLE', 'ai-gov-mcp-connectors-dev'), partitionKey: 'tenantId', sortKey: 'recordKey', ttlField: 'ttl' }),
  /** Admin activity and sign-ins, keyed `<ISO time>#<id>` so a tenant's history is one ordered query. */
  activity: (): CollectionSpec => ({ name: 'activity', table: env('ACTIVITY_TABLE', 'ai-gov-activity-dev'), partitionKey: 'tenantId', sortKey: 'eventKey', ttlField: 'ttl' }),
  /** Log export: destinations (`dest#<id>`) and batches that could not be delivered (`dead#<time>#<id>`). */
  logExport: (): CollectionSpec => ({ name: 'log_export', table: env('LOG_EXPORT_TABLE', 'ai-gov-log-export-dev'), partitionKey: 'tenantId', sortKey: 'recordKey', ttlField: 'ttl' }),
  /** Lock and verify: AI-domain feeds (`feed#<id>`) and lock settings (`aws#settings`). */
  enforcement: (): CollectionSpec => ({ name: 'enforcement', table: env('ENFORCEMENT_TABLE', 'ai-gov-enforcement-dev'), partitionKey: 'tenantId', sortKey: 'recordKey' }),
};

export type CollectionName = keyof typeof SPECS;

let shared: RecordStore | null = null;

/**
 * The record store chosen by STORAGE_BACKEND:
 *  - dynamodb (default): AWS_REGION, and AWS_ENDPOINT_URL for LocalStack
 *  - postgres: DATABASE_URL, optional PG_TABLE_PREFIX
 *  - memory: in this process only (tests)
 */
export function storeFromEnv(): RecordStore {
  const backend = (process.env.STORAGE_BACKEND || 'dynamodb').toLowerCase();
  if (backend === 'dynamodb') return new DynamoStore();
  if (backend === 'postgres' || backend === 'postgresql') {
    if (!process.env.DATABASE_URL) throw new StorageError('STORAGE_BACKEND=postgres needs DATABASE_URL');
    return new PostgresStore({ connectionString: process.env.DATABASE_URL, tablePrefix: process.env.PG_TABLE_PREFIX || '' });
  }
  if (backend === 'memory') return new MemoryStore();
  throw new StorageError(`Unknown STORAGE_BACKEND: ${backend} (use dynamodb, postgres or memory)`);
}

/** The process-wide record store. */
export function records(): RecordStore {
  if (!shared) shared = storeFromEnv();
  return shared;
}

/** Replace the process-wide store (tests, or a service that builds its own). */
export function setRecords(store: RecordStore | null) {
  shared = store;
}

/** A collection of the process-wide store, by name. */
export function collection<T extends object = Item>(name: CollectionName): Collection<T> {
  return records().collection<T>(SPECS[name]());
}

let sharedObjects: Map<string, ObjectStore> | null = null;
let objectsOverride: ObjectStore | null = null;

/**
 * Where files go, chosen by OBJECT_STORE:
 *  - s3 (default): the bucket; S3_ENDPOINT for an S3-compatible store such as MinIO
 *  - file: OBJECT_STORE_DIR/<bucket>/…
 *  - memory: in this process only (tests)
 */
export function objects(bucket: string, options: { kms?: boolean } = {}): ObjectStore {
  if (objectsOverride) return objectsOverride;
  if (!sharedObjects) sharedObjects = new Map();
  const id = `${bucket}|${options.kms ? 'kms' : ''}`;
  let store = sharedObjects.get(id);
  if (!store) {
    const kind = (process.env.OBJECT_STORE || 's3').toLowerCase();
    if (kind === 's3') {
      const endpoint = process.env.S3_ENDPOINT;
      const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1', forcePathStyle: true, ...(endpoint ? { endpoint } : {}) });
      store = new S3ObjectStore(bucket, s3, options);
    } else if (kind === 'file') {
      store = new FileObjectStore(`${process.env.OBJECT_STORE_DIR || './data/objects'}/${bucket}`);
    } else if (kind === 'memory') {
      store = new MemoryObjectStore();
    } else {
      throw new StorageError(`Unknown OBJECT_STORE: ${kind} (use s3, file or memory)`);
    }
    sharedObjects.set(id, store);
  }
  return store;
}

/** Send every object write to one store (tests). */
export function setObjects(store: ObjectStore | null) {
  objectsOverride = store;
  sharedObjects = null;
}
