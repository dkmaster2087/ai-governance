import { FastifyInstance } from 'fastify';
import { collection, MemoryObjectStore, MemoryStore, objects, setObjects, setRecords } from '@ai-governance/storage';
import { AuditLog } from '@ai-governance/types';
import { INTERNAL_HEADER, newInternalKey, signingKeyFrom, signInternal, trustedKeysFrom } from '@ai-governance/utils';
import { buildApp } from '../app';
import { queryAuditLogs } from '../reports/audit-query';

const GW = newInternalKey('gateway');
const KEY = signingKeyFrom(GW.signing);
const TRUSTED = trustedKeysFrom([GW.trusted]);
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const BUCKET = process.env.AUDIT_LOG_BUCKET || 'ai-governance-audit-logs';

function log(tenantId: string, requestId: string, timestamp: string): AuditLog & Record<string, unknown> {
  return {
    logId: `${requestId}-${Date.parse(timestamp)}`, requestId, tenantId, userId: 'jane', appId: 'support-bot',
    eventType: 'request_allowed', provider: 'openai', modelId: 'gpt-4o-mini', promptHash: 'h', responseHash: 'r', policyDecision: 'allow',
    triggeredRules: [], piiDetected: false, piiTypes: [], inputTokens: 10, outputTokens: 20, estimatedCost: 0.5, latencyMs: 100,
    timestamp, metadata: {},
  } as AuditLog & Record<string, unknown>;
}

/** What the gateway does: a database record, and an archive copy filed under the day it was written. */
async function record(l: AuditLog, inDatabase: boolean) {
  if (inDatabase) await collection('auditLogs').put(l as AuditLog & Record<string, unknown>);
  await objects(BUCKET, { kms: true }).put(`logs/${l.tenantId}/${l.timestamp.slice(0, 10)}/${l.logId}.json`, JSON.stringify(l));
}

describe('evidence older than the database window', () => {
  let app: FastifyInstance;
  const as = (tenantId: string) => ({ [INTERNAL_HEADER]: signInternal({ tenantId, userId: 'u1', role: 'tenant_admin' }, KEY, 'analytics') });
  const get = (url: string, tenantId = 'tenant_a') => app.inject({ method: 'GET', url, headers: as(tenantId) });

  beforeEach(async () => {
    setRecords(new MemoryStore());
    setObjects(new MemoryObjectStore());
    app = await buildApp({ trusted: TRUSTED });
    await collection('tenants').put({ tenantId: 'tenant_a', settings: { auditLogRetentionDays: 365 } });
    await collection('tenants').put({ tenantId: 'tenant_b' });
    await record(log('tenant_a', 'recent', daysAgo(85)), true);
    // Past the window: the database has let these go; only the archive has them.
    await record(log('tenant_a', 'older', daysAgo(95)), false);
    await record(log('tenant_a', 'oldest', daysAgo(200)), false);
  });
  afterAll(() => setObjects(null));

  it('reads the recent part from the database and the older part from the archive, newest first', async () => {
    const r = await queryAuditLogs('tenant_a', daysAgo(105), daysAgo(80));
    expect(r.logs.map((l) => l.requestId)).toEqual(['recent', 'older']);
    expect(r.archived).toBe(true);
    const recentOnly = await queryAuditLogs('tenant_a', daysAgo(30), daysAgo(0));
    expect(recentOnly.archived).toBe(false);
  });

  it('finds old records in evidence search and says they came from the archive', async () => {
    const res = await get(`/internal/v1/evidence?from=${encodeURIComponent(daysAgo(210))}&to=${encodeURIComponent(daysAgo(190))}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().archived).toBe(true);
    expect(res.json().items.map((i: { requestId: string }) => i.requestId)).toEqual(['oldest']);
  });

  it('opens an old case file from the archive, only for its own company', async () => {
    const res = await get('/internal/v1/evidence/older');
    expect(res.statusCode).toBe(200);
    expect(res.json().requestId).toBe('older');
    expect((await get('/internal/v1/evidence/oldest')).statusCode).toBe(200);
    expect((await get('/internal/v1/evidence/older', 'tenant_b')).statusCode).toBe(404);
  });

  it('without an archive, the database is the only source', async () => {
    const saved = process.env.OBJECT_STORE;
    process.env.OBJECT_STORE = 'none';
    try {
      const r = await queryAuditLogs('tenant_a', daysAgo(105), daysAgo(80));
      expect(r.logs.map((l) => l.requestId)).toEqual(['recent']);
      expect(r.archived).toBe(false);
      expect((await get('/internal/v1/evidence/older')).statusCode).toBe(404);
    } finally {
      process.env.OBJECT_STORE = saved;
    }
  });
});
