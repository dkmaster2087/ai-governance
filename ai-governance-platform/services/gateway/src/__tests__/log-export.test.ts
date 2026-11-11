import Fastify, { FastifyInstance } from 'fastify';
import { collection, MemoryStore, setRecords } from '@ai-governance/storage';
import { AuditLog } from '@ai-governance/types';
import { ActivityLog, buildRecord, recordHash, setActivityLog } from '../activity/activity-log';
import { actionFor, createAdminActivityPlugin, idsFromBody, outcomeFor } from '../activity/admin-activity';
import { SignInRecorder } from '../activity/sign-ins';
import { createAuthPlugin } from '../middleware/auth.middleware';
import { buildRequest, signatureHeader, verifySignature } from '../log-export/formats';
import { fromActivity, fromDecision, sampleRecord } from '../log-export/records';
import { checkDestinationUrl, Destination, DestinationStore, setDestinationStore } from '../log-export/destinations';
import { Exporter, ExporterOptions, setExporter, Transport } from '../log-export/exporter';
import { logExportRoutes } from '../routes/log-export.routes';
import { activityRoutes } from '../routes/activity.routes';
import type { SecretBackend } from '../services/provider-key.store';
import type { Principal } from '../auth/principal';

const T = 'tenant_acme';

class MemorySecrets implements SecretBackend {
  values = new Map<string, string>();
  async put(name: string, value: string) { this.values.set(`arn:${name}`, value); return `arn:${name}`; }
  async get(arn: string) { const v = this.values.get(arn); if (v === undefined) throw new Error('no secret'); return v; }
  async delete(arn: string) { this.values.delete(arn); }
}

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  setRecords(new MemoryStore());
  setActivityLog(null);
  setDestinationStore(null);
  setExporter(null);
});

// ── Activity trail ──────────────────────────────────────────────────────────────────────────────

describe('activity records', () => {
  it('hash the record canonically, so a changed copy is spotted', () => {
    const rec = buildRecord({ tenantId: T, category: 'admin', action: 'rule.created', outcome: 'success', actor: { type: 'user', id: 'u1', role: 'tenant_admin' }, target: { policyId: 'p1' } });
    expect(rec.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(recordHash(rec)).toBe(rec.hash);
    expect(recordHash({ ...rec, action: 'rule.deleted' })).not.toBe(rec.hash);
    expect(rec.eventKey.startsWith(rec.time)).toBe(true);
    expect(rec.ttl).toBeGreaterThan(Date.now() / 1000 + 300 * 86_400);
  });

  it('records an event with a fixed ID once, and lists newest first with filters and pages', async () => {
    const log = new ActivityLog();
    const once = { tenantId: T, category: 'sign_in' as const, action: 'sign_in.dashboard', outcome: 'success' as const, actor: { type: 'user' as const, id: 'u' }, eventId: 'si_fixed', time: '2026-11-01T10:00:00.000Z' };
    expect(await log.record(once)).not.toBeNull();
    expect(await log.record(once)).toBeNull();
    for (let i = 0; i < 7; i++) {
      await log.record({ tenantId: T, category: 'admin', action: `a.${i}`, outcome: i % 2 ? 'denied' : 'success', actor: { type: 'user', id: 'u' }, time: `2026-11-02T10:00:0${i}.000Z` });
    }
    await log.record({ tenantId: 'tenant_other', category: 'admin', action: 'x', outcome: 'success', actor: { type: 'user', id: 'v' } });

    const all = await log.list(T, { limit: 3 });
    expect(all.items.map((r) => r.action)).toEqual(['a.6', 'a.5', 'a.4']);
    const page2 = await log.list(T, { limit: 3, after: all.next });
    expect(page2.items.map((r) => r.action)).toEqual(['a.3', 'a.2', 'a.1']);
    const page3 = await log.list(T, { limit: 3, after: page2.next });
    expect(page3.items.map((r) => r.action)).toEqual(['a.0', 'sign_in.dashboard']);
    expect(page3.next).toBeUndefined();

    expect((await log.list(T, { category: 'sign_in' })).items).toHaveLength(1);
    expect((await log.list(T, { outcome: 'denied' })).items.map((r) => r.action)).toEqual(['a.5', 'a.3', 'a.1']);
    expect((await log.list(T, { from: '2026-11-02T10:00:05.000Z' })).items.map((r) => r.action)).toEqual(['a.6', 'a.5']);
  });
});

describe('admin activity hook', () => {
  it('names actions from routes, and leaves traffic out', () => {
    expect(actionFor('POST', '/v1/rules')).toBe('rule.created');
    expect(actionFor('POST', '/v1/mcp/servers/:serverId/publish')).toBe('mcp_server.published');
    expect(actionFor('PUT', '/v1/something-new/:id')).toBe('something_new.changed');
    // People and legal hold are what auditors ask about first, so they get their own names.
    expect(actionFor('POST', '/v1/users')).toBe('user.invited');
    expect(actionFor('PATCH', '/v1/users/:email')).toBe('user.changed');
    expect(actionFor('PUT', '/v1/tenants/:tenantId/legal-hold')).toBe('legal_hold.changed');
    expect(actionFor('GET', '/v1/rules')).toBeNull();
    expect(actionFor('POST', '/v1/chat/completions')).toBeNull();
    expect(actionFor('POST', '/mcp/:tenantId/:serverId')).toBeNull();
    expect(actionFor('POST', '/oauth/:tenantId/token')).toBeNull();
    expect([outcomeFor(201), outcomeFor(403), outcomeFor(401), outcomeFor(400), outcomeFor(503)]).toEqual(['success', 'denied', 'denied', null, 'failure']);
  });

  it('keeps only IDs from a response, never a raw key', () => {
    expect(idsFromBody(JSON.stringify({ keyId: 'key_1', key: 'pbl_acme_secret', name: 'ci' }))).toEqual({ keyId: 'key_1' });
    expect(idsFromBody(JSON.stringify({ server: { serverId: 's1', token: 'x' } }))).toEqual({ serverId: 's1' });
    expect(idsFromBody('not json')).toEqual({});
  });

  async function appAs(principal: Principal | null, tenantId = T) {
    const app = Fastify();
    app.decorateRequest('principal', null);
    app.addHook('onRequest', async (req) => {
      req.principal = principal; req.tenantId = tenantId; req.userId = principal?.kind === 'user' ? principal.userId : 'x';
      req.correlationId = 'req-1';
    });
    await app.register(createAdminActivityPlugin());
    app.post('/v1/rules', async () => ({ policyId: 'pol_1', ruleId: 'r_9' }));
    app.post('/v1/api-keys', async () => ({ keyId: 'key_1', key: 'pbl_acme_rawsecret' }));
    app.post('/v1/tenants/:tenantId/suspend', async (_req, reply) => (principal?.kind === 'user' && principal.role === 'platform_admin' ? { ok: true } : reply.status(403).send({})));
    app.post('/v1/bad', async (_req, reply) => reply.status(400).send({}));
    app.post('/v1/chat/completions', async () => ({}));
    return app;
  }

  it('records changes with who, what and where, and denied attempts on the affected tenant', async () => {
    const admin: Principal = { kind: 'user', homeTenantId: T, userId: 'u_admin', email: 'ana@acme.example', role: 'tenant_admin' };
    const app = await appAs(admin);
    await app.inject({ method: 'POST', url: '/v1/rules', payload: { name: 'No secrets', pattern: 'SECRET-.*' }, headers: { 'user-agent': 'jest' } });
    await app.inject({ method: 'POST', url: '/v1/api-keys', payload: {} });
    await app.inject({ method: 'POST', url: '/v1/tenants/tenant_victim/suspend' });
    await app.inject({ method: 'POST', url: '/v1/bad' });
    await app.inject({ method: 'POST', url: '/v1/chat/completions' });
    await flush();

    const mine = (await new ActivityLog().list(T)).items;
    expect(mine.map((r) => r.action).sort()).toEqual(['api_key.created', 'rule.created']);
    const rule = mine.find((r) => r.action === 'rule.created')!;
    expect(rule).toMatchObject({ category: 'admin', outcome: 'success', actor: { type: 'user', id: 'u_admin', email: 'ana@acme.example', role: 'tenant_admin' }, target: { policyId: 'pol_1', ruleId: 'r_9' }, requestId: 'req-1', userAgent: 'jest' });
    expect(JSON.stringify(mine)).not.toContain('SECRET-');
    expect(JSON.stringify(mine)).not.toContain('rawsecret');

    const victim = (await new ActivityLog().list('tenant_victim')).items;
    expect(victim).toHaveLength(1);
    expect(victim[0]).toMatchObject({ action: 'tenant.suspended', outcome: 'denied', detail: { status: 403, actingTenant: T } });
  });
});

describe('sign-in records', () => {
  it('records a dashboard sign-in once, and a refused key at most once a minute', async () => {
    let now = 1_000_000;
    const rec = new SignInRecorder(undefined, () => now);
    const req: any = { correlationId: 'r', clientIp: '203.0.113.9', headers: { 'user-agent': 'Chrome' } };
    rec.dashboardSession(req, T, { sub: 'u1', email: 'ana@acme.example', 'custom:role': 'tenant_admin', auth_time: 1_762_400_000 });
    rec.dashboardSession(req, T, { sub: 'u1', email: 'ana@acme.example', auth_time: 1_762_400_000 });
    // Another gateway instance (fresh recorder) seeing the same sign-in writes nothing new.
    new SignInRecorder().dashboardSession(req, T, { sub: 'u1', auth_time: 1_762_400_000 });
    rec.keyRefused(req, { tenantId: T, keyId: 'key_1', name: 'ci' }, 'KEY_REVOKED');
    rec.keyRefused(req, { tenantId: T, keyId: 'key_1' }, 'KEY_REVOKED');
    now += 61_000;
    rec.keyRefused(req, { tenantId: T, keyId: 'key_1' }, 'KEY_REVOKED');
    await flush(); await flush();
    const items = (await new ActivityLog().list(T, { category: 'sign_in' })).items;
    expect(items.filter((i) => i.action === 'sign_in.dashboard')).toHaveLength(1);
    expect(items.filter((i) => i.action === 'sign_in.api_key')).toHaveLength(2);
    expect(items.find((i) => i.action === 'sign_in.dashboard')).toMatchObject({ time: new Date(1_762_400_000 * 1000).toISOString(), sourceIp: '203.0.113.9' });
  });

  it('the auth middleware records revoked and expired keys used against the gateway', async () => {
    const app = Fastify();
    await app.register(createAuthPlugin({
      keys: {
        findByHash: async () => ({ tenantId: T, keyId: 'key_old', status: 'revoked', name: 'old ci' } as any),
        touchLastUsed: async () => undefined,
      },
      devAuth: false, keyCacheTtlMs: 0, signIns: new SignInRecorder(),
    }));
    app.get('/v1/models', async () => ({}));
    const res = await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: 'Bearer pbl_acme_whatever' } });
    expect(res.statusCode).toBe(401);
    await flush(); await flush();
    const items = (await new ActivityLog().list(T)).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ category: 'sign_in', action: 'sign_in.api_key', outcome: 'denied', actor: { keyId: 'key_old' }, detail: { reason: 'KEY_REVOKED', keyName: 'old ci' } });
  });
});

// ── Formats ─────────────────────────────────────────────────────────────────────────────────────

const decision = (i: number, over: Partial<AuditLog> = {}): AuditLog => ({
  logId: `req_${i}-1`, requestId: `req_${i}`, tenantId: T, userId: 'ana@acme.example', appId: 'support-bot', eventType: 'request_blocked',
  provider: 'openai', modelId: 'gpt-4o-mini', promptHash: 'abc', responseHash: '', policyDecision: 'block', triggeredRules: ['No customer IDs'],
  piiDetected: false, piiTypes: [], inputTokens: 0, outputTokens: 0, estimatedCost: 0, latencyMs: 12, timestamp: `2026-11-06T10:00:${String(i).padStart(2, '0')}.000Z`,
  metadata: { policyReason: 'Customer ID in prompt', evidenceHit: 'CUST-1234', evidenceBefore: 'my id is' }, ...over,
});

describe('export formats', () => {
  it('decision records carry the reason but never the prompt excerpt', () => {
    const r = fromDecision(decision(1));
    expect(r).toMatchObject({ schema: 'probaline.log/1', type: 'decision', action: 'ai.request', outcome: 'stopped', requestId: 'req_1', target: { provider: 'openai', model: 'gpt-4o-mini' }, detail: { reason: 'Customer ID in prompt' } });
    expect(JSON.stringify(r)).not.toContain('CUST-1234');
    const mcp = fromDecision(decision(2, { eventType: 'request_allowed', metadata: { kind: 'mcp_tool_call', mcpServer: 'hr', mcpTool: 'listEmployees', caller: 'person', backendStatus: '200' } }));
    expect(mcp).toMatchObject({ action: 'mcp.tool_call', outcome: 'allowed', actor: { type: 'person' }, target: { server: 'hr', tool: 'listEmployees' }, detail: { backendStatus: 200 } });
  });

  it('activity records keep their hash', () => {
    const rec = buildRecord({ tenantId: T, category: 'sign_in', action: 'sign_in.mcp', outcome: 'failure', actor: { type: 'person', id: 'p' }, sourceIp: '198.51.100.1' });
    expect(fromActivity(rec)).toMatchObject({ type: 'sign_in', outcome: 'failure', source: { ip: '198.51.100.1' }, detail: { recordHash: rec.hash } });
  });

  it('webhooks are signed and the signature checks out (and fails when the body changes or is old)', () => {
    const records = [sampleRecord(T, 'u')];
    const now = new Date('2026-11-06T12:00:00Z');
    const req = buildRequest({ kind: 'webhook' }, { url: 'https://siem.acme.example/in', signingSecret: 'whsec_test' }, records, 'b_1', now);
    const sig = req.headers['x-probaline-signature'];
    const t = now.getTime() / 1000;
    expect(sig).toBe(signatureHeader('whsec_test', req.body, t));
    expect(verifySignature('whsec_test', req.body, sig, t)).toBe(true);
    expect(verifySignature('whsec_test', req.body + ' ', sig, t)).toBe(false);
    expect(verifySignature('whsec_other', req.body, sig, t)).toBe(false);
    expect(verifySignature('whsec_test', req.body, sig, t + 3600)).toBe(false);
    expect(JSON.parse(req.body)).toMatchObject({ schema: 'probaline.batch/1', batchId: 'b_1', count: 1 });
  });

  it('Splunk HEC gets one event per line with the token and sourcetype', () => {
    const req = buildRequest({ kind: 'splunk_hec', splunkIndex: 'security' }, { url: 'https://splunk.acme.example:8088', token: 'hec-token-1234' }, [fromDecision(decision(1)), fromDecision(decision(2))], 'b_2');
    expect(req.url).toBe('https://splunk.acme.example:8088/services/collector/event');
    expect(req.headers.authorization).toBe('Splunk hec-token-1234');
    const lines = req.body.split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ sourcetype: 'probaline:decision', index: 'security', source: 'probaline', event: { requestId: 'req_1' } });
    expect(lines[0].time).toBe(Date.parse('2026-11-06T10:00:01.000Z') / 1000);
  });

  it('OTLP/HTTP gets resource logs with severity and attributes, and the collector headers', () => {
    const req = buildRequest({ kind: 'otlp_http' }, { url: 'https://otel.acme.example:4318', headers: { 'DD-API-KEY': 'dd' } }, [fromDecision(decision(3))], 'b_3');
    expect(req.url).toBe('https://otel.acme.example:4318/v1/logs');
    expect(req.headers['DD-API-KEY']).toBe('dd');
    const body = JSON.parse(req.body);
    const lr = body.resourceLogs[0].scopeLogs[0].logRecords[0];
    expect(body.resourceLogs[0].resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'probaline' } });
    expect(lr).toMatchObject({ severityText: 'WARN', severityNumber: 13, timeUnixNano: String(Date.parse('2026-11-06T10:00:03.000Z')) + '000000' });
    expect(lr.attributes).toContainEqual({ key: 'probaline.outcome', value: { stringValue: 'stopped' } });
    expect(JSON.parse(lr.body.stringValue).requestId).toBe('req_3');
  });

  it('refuses plain http, private addresses and credentials in the address', () => {
    expect(() => checkDestinationUrl('http://siem.acme.example')).toThrow(/https/);
    expect(() => checkDestinationUrl('https://10.0.0.5/in')).toThrow(/Private/);
    expect(() => checkDestinationUrl('https://localhost:8088')).toThrow(/Private/);
    expect(() => checkDestinationUrl('https://u:p@siem.acme.example')).toThrow(/credentials/);
    expect(checkDestinationUrl('https://endpoint1.collection.sumologic.com/receiver/v1/http/ZaVnC4dhaV').host).toBe('endpoint1.collection.sumologic.com');
  });
});

// ── Delivery ────────────────────────────────────────────────────────────────────────────────────

const OPTS: ExporterOptions = { intervalMs: 1000, settleMs: 1000, retryBaseMs: 1000, maxAttempts: 3, batchSize: 2, timeoutMs: 1000 };

async function setup(recordTypes: Destination['recordTypes'] = ['decisions', 'admin_activity', 'sign_ins']) {
  const secrets = new MemorySecrets();
  const store = new DestinationStore(secrets, 'test');
  setDestinationStore(store);
  const d: Destination = {
    tenantId: T, recordKey: 'dest#dst_1', destinationId: 'dst_1', name: 'SIEM', kind: 'webhook', recordTypes, enabled: true,
    urlHint: 'https://siem.acme.example', secretRef: '', createdAt: '2026-11-06T09:00:00.000Z', createdBy: 'u', updatedAt: '2026-11-06T09:00:00.000Z',
    cursorDecisions: { after: '2026-11-06T09:00:00.000Z', ids: [] }, cursorActivity: { after: '2026-11-06T09:00:00.000Z' },
    deliveredCount: 0, deadLetterCount: 0, leaseId: 'none', leaseUntil: 0,
  };
  await store.create(d, { url: 'https://siem.acme.example/in', signingSecret: 'whsec_x' });
  return { store, secrets };
}

function receiver(fail: () => boolean = () => false) {
  const got: any[] = [];
  const transport: Transport = async (req) => {
    if (fail()) return { status: 503, body: 'busy', ms: 1 };
    got.push({ ...JSON.parse(req.body), headers: req.headers });
    return { status: 200, body: 'ok', ms: 1 };
  };
  return { got, transport };
}

describe('delivery', () => {
  let now: number;
  const clock = () => now;
  beforeEach(() => { now = Date.parse('2026-11-06T11:00:00.000Z'); });

  it('sends new decisions and activity in batches, once each, oldest first', async () => {
    const { store } = await setup();
    const audit = collection<any>('auditLogs');
    for (const i of [1, 2, 3]) await audit.put({ ...decision(i), dateKey: '2026-11-06' });
    await audit.put({ ...decision(4), timestamp: '2026-11-06T08:00:00.000Z' }); // before the destination existed
    await new ActivityLog().record({ tenantId: T, category: 'admin', action: 'rule.created', outcome: 'success', actor: { type: 'user', id: 'u' }, time: '2026-11-06T10:30:00.000Z' });
    const { got, transport } = receiver();
    const ex = new Exporter(OPTS, () => store, transport, undefined, clock);

    await ex.runDestination(T, 'dst_1');
    const ids = got.flatMap((b) => b.records.map((r: any) => r.id));
    expect(ids).toEqual(['req_1-1', 'req_2-1', 'req_3-1', expect.stringMatching(/^act_/)]);
    expect(got.every((b) => b.records.length <= 2)).toBe(true);
    expect(got[0].headers['x-probaline-signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);

    // A decision in the same millisecond as the last one sent still goes, and nothing goes twice.
    await audit.put({ ...decision(3), requestId: 'req_3b', logId: 'req_3b-1' });
    await ex.runDestination(T, 'dst_1');
    expect(got.flatMap((b) => b.records.map((r: any) => r.id)).slice(4)).toEqual(['req_3b-1']);
    await ex.runDestination(T, 'dst_1');
    expect(got.flatMap((b) => b.records)).toHaveLength(5);
    const d = (await store.get(T, 'dst_1'))!;
    expect(d).toMatchObject({ deliveredCount: 5, leaseId: 'none' });
    expect(d.lastDeliveredAt).toBeDefined();
  });

  it('sends only the record types chosen, but moves past the others', async () => {
    const { store } = await setup(['sign_ins']);
    const log = new ActivityLog();
    await log.record({ tenantId: T, category: 'admin', action: 'rule.created', outcome: 'success', actor: { type: 'user', id: 'u' }, time: '2026-11-06T10:00:00.000Z' });
    await log.record({ tenantId: T, category: 'sign_in', action: 'sign_in.api_key', outcome: 'denied', actor: { type: 'api_key', id: 'k' }, time: '2026-11-06T10:01:00.000Z' });
    await log.record({ tenantId: T, category: 'admin', action: 'rule.deleted', outcome: 'success', actor: { type: 'user', id: 'u' }, time: '2026-11-06T10:02:00.000Z' });
    await collection<any>('auditLogs').put(decision(1));
    const { got, transport } = receiver();
    await new Exporter(OPTS, () => store, transport, undefined, clock).runDestination(T, 'dst_1');
    expect(got.flatMap((b) => b.records.map((r: any) => r.action))).toEqual(['sign_in.api_key']);
    expect((await store.get(T, 'dst_1'))!.cursorActivity.after.startsWith('2026-11-06T10:02:00.000Z')).toBe(true);
  });

  it('leaves the newest records for the next round', async () => {
    const { store } = await setup();
    await collection<any>('auditLogs').put(decision(1, { timestamp: new Date(now - 200).toISOString() }));
    const { got, transport } = receiver();
    await new Exporter(OPTS, () => store, transport, undefined, clock).runDestination(T, 'dst_1');
    expect(got).toHaveLength(0);
    now += 2000;
    await new Exporter(OPTS, () => store, transport, undefined, clock).runDestination(T, 'dst_1');
    expect(got).toHaveLength(1);
  });

  it('retries with backoff, then moves the batch to dead letters and carries on; a dead letter can be sent again', async () => {
    const { store } = await setup(['decisions']);
    for (const i of [1, 2, 3]) await collection<any>('auditLogs').put(decision(i));
    let failing = true;
    const { got, transport } = receiver(() => failing);
    const ex = new Exporter(OPTS, () => store, transport, undefined, clock);

    await ex.runDestination(T, 'dst_1');
    let d = (await store.get(T, 'dst_1'))!;
    expect(d.pending).toMatchObject({ attempts: 1, nextAttemptAt: now + 1000 });
    expect(d.lastError).toBe('The destination answered 503: busy');
    await ex.runDestination(T, 'dst_1'); // not due yet
    expect((await store.get(T, 'dst_1'))!.pending!.attempts).toBe(1);
    now += 1000; await ex.runDestination(T, 'dst_1');
    expect((await store.get(T, 'dst_1'))!.pending).toMatchObject({ attempts: 2, nextAttemptAt: now + 2000 });
    now += 2000; await ex.runDestination(T, 'dst_1'); // third try fails: dead letter, then the next batch is tried
    d = (await store.get(T, 'dst_1'))!;
    expect(d.deadLetterCount).toBe(2);
    expect(d.pending).toMatchObject({ attempts: 1, records: [expect.objectContaining({ id: 'req_3-1' })] });
    const dead = await store.deadLetters(T);
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ destinationId: 'dst_1', count: 2, attempts: 3, error: 'The destination answered 503: busy' });

    failing = false;
    now += 1000; await ex.runDestination(T, 'dst_1');
    expect(got.flatMap((b) => b.records.map((r: any) => r.id))).toEqual(['req_3-1']);
    expect((await ex.send((await store.get(T, 'dst_1'))!, dead[0].records)).ok).toBe(true);
    expect(got.flatMap((b) => b.records.map((r: any) => r.id))).toEqual(['req_3-1', 'req_1-1', 'req_2-1']);
  });

  it('one gateway at a time sends for a destination', async () => {
    const { store } = await setup(['decisions']);
    await collection<any>('auditLogs').put(decision(1));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let calls = 0;
    const slow: Transport = async () => { calls++; await gate; return { status: 200, body: '', ms: 1 }; };
    const a = new Exporter(OPTS, () => store, slow, undefined, clock);
    const b = new Exporter(OPTS, () => store, slow, undefined, clock);
    const first = a.runDestination(T, 'dst_1');
    await new Promise((r) => setTimeout(r, 10));
    await b.runDestination(T, 'dst_1');
    release();
    await first;
    expect(calls).toBe(1);
  });

  it('skips paused destinations', async () => {
    const { store } = await setup();
    await store.update(T, 'dst_1', { set: { enabled: false } });
    await collection<any>('auditLogs').put(decision(1));
    const { got, transport } = receiver();
    await new Exporter(OPTS, () => store, transport, undefined, clock).tick();
    expect(got).toHaveLength(0);
  });
});

// ── API ─────────────────────────────────────────────────────────────────────────────────────────

describe('log export API', () => {
  let app: FastifyInstance;
  let secrets: MemorySecrets;
  let sent: any[];
  let role: 'tenant_admin' | 'tenant_auditor';

  beforeEach(async () => {
    secrets = new MemorySecrets();
    setDestinationStore(new DestinationStore(secrets, 'test'));
    sent = [];
    const transport: Transport = async (req) => { sent.push(req); return req.url.includes('broken') ? { status: 401, body: 'bad token', ms: 3 } : { status: 200, body: '{"text":"Success","code":0}', ms: 3 }; };
    setExporter(new Exporter(OPTS, undefined, transport));
    role = 'tenant_admin';
    app = Fastify();
    app.decorateRequest('principal', null);
    app.addHook('onRequest', async (req) => {
      req.principal = { kind: 'user', homeTenantId: T, userId: 'u_admin', role };
      req.tenantId = T; req.userId = 'u_admin'; req.correlationId = 'c';
    });
    await app.register(createAdminActivityPlugin());
    await app.register(logExportRoutes, { prefix: '/v1' });
    await app.register(activityRoutes, { prefix: '/v1' });
  });

  it('creates a webhook, shows the signing secret once and keeps it out of the database', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/log-export/destinations', payload: { kind: 'webhook', name: 'SIEM', url: 'https://hooks.acme.example/probaline/abcdefghijklmnopqrstuvwxyz', recordTypes: ['decisions', 'admin_activity'] } });
    expect(res.statusCode).toBe(201);
    const { destination, signingSecret } = res.json();
    expect(signingSecret).toMatch(/^whsec_/);
    expect(destination).toMatchObject({ kind: 'webhook', enabled: true, urlHint: 'https://hooks.acme.example/probaline/abcde…', secretHint: `…${signingSecret.slice(-4)}` });
    expect(destination.secretRef).toBeUndefined();
    const stored = await collection<any>('logExport').get({ tenantId: T, recordKey: `dest#${destination.destinationId}` });
    expect(JSON.stringify(stored)).not.toContain(signingSecret);
    expect(JSON.stringify(stored)).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(JSON.parse(secrets.values.get(stored.secretRef)!)).toMatchObject({ signingSecret, url: 'https://hooks.acme.example/probaline/abcdefghijklmnopqrstuvwxyz' });

    const list = (await app.inject({ method: 'GET', url: '/v1/log-export' })).json();
    expect(list.destinations).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(signingSecret);

    const test = (await app.inject({ method: 'POST', url: `/v1/log-export/destinations/${destination.destinationId}/test` })).json();
    expect(test).toMatchObject({ ok: true, status: 200 });
    expect(verifySignature(signingSecret, sent[0].body, sent[0].headers['x-probaline-signature'])).toBe(true);

    await new Promise((r) => setImmediate(r));
    const activity = (await app.inject({ method: 'GET', url: '/v1/activity?category=admin' })).json();
    expect(activity.items.map((i: any) => i.action)).toEqual(['log_export.tested', 'log_export.created']);
    expect(activity.items[1].target).toEqual({ destinationId: destination.destinationId });
  });

  it('creates Splunk and OTLP destinations, edits them, and reports a failing test plainly', async () => {
    const missing = await app.inject({ method: 'POST', url: '/v1/log-export/destinations', payload: { kind: 'splunk_hec', name: 'Splunk', url: 'https://splunk.acme.example:8088', recordTypes: ['sign_ins'] } });
    expect(missing.statusCode).toBe(400);
    const splunk = (await app.inject({ method: 'POST', url: '/v1/log-export/destinations', payload: { kind: 'splunk_hec', name: 'Splunk', url: 'https://broken.splunk.acme.example:8088', token: 'hec-12345678', splunkIndex: 'sec', recordTypes: ['sign_ins'] } })).json();
    expect(splunk.signingSecret).toBeUndefined();
    expect(splunk.destination).toMatchObject({ secretHint: '…5678', splunkIndex: 'sec' });
    const failed = (await app.inject({ method: 'POST', url: `/v1/log-export/destinations/${splunk.destination.destinationId}/test` })).json();
    expect(failed).toMatchObject({ ok: false, status: 401, message: 'The destination answered 401: bad token' });
    expect(sent[0].headers.authorization).toBe('Splunk hec-12345678');

    const otlp = (await app.inject({ method: 'POST', url: '/v1/log-export/destinations', payload: { kind: 'otlp_http', name: 'Datadog', url: 'https://otel.acme.example:4318', headers: [{ name: 'DD-API-KEY', value: 'dd-secret' }], recordTypes: ['decisions'] } })).json();
    expect(otlp.destination.headerNames).toEqual(['DD-API-KEY']);
    expect(JSON.stringify(otlp)).not.toContain('dd-secret');
    const bad = await app.inject({ method: 'POST', url: '/v1/log-export/destinations', payload: { kind: 'otlp_http', name: 'x', url: 'https://o.example', headers: [{ name: 'Host', value: 'evil' }], recordTypes: ['decisions'] } });
    expect(bad.statusCode).toBe(400);

    const id = otlp.destination.destinationId;
    const edited = (await app.inject({ method: 'PATCH', url: `/v1/log-export/destinations/${id}`, payload: { enabled: false, recordTypes: ['decisions', 'sign_ins'], url: 'https://otel2.acme.example:4318' } })).json();
    expect(edited.destination).toMatchObject({ enabled: false, recordTypes: ['decisions', 'sign_ins'], urlHint: 'https://otel2.acme.example:4318', headerNames: ['DD-API-KEY'] });
    const stored = await collection<any>('logExport').get({ tenantId: T, recordKey: `dest#${id}` });
    expect(JSON.parse(secrets.values.get(stored.secretRef)!)).toEqual({ url: 'https://otel2.acme.example:4318/', headers: { 'DD-API-KEY': 'dd-secret' } });

    expect((await app.inject({ method: 'POST', url: '/v1/log-export/destinations', payload: { kind: 'webhook', name: 'x', url: 'http://plain.example', recordTypes: ['decisions'] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/log-export/destinations', payload: { kind: 'webhook', name: 'x', url: 'https://plain.example', recordTypes: [] } })).statusCode).toBe(400);

    expect((await app.inject({ method: 'DELETE', url: `/v1/log-export/destinations/${id}` })).statusCode).toBe(200);
    expect(secrets.values.has(stored.secretRef)).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/v1/log-export' })).json().destinations).toHaveLength(1);
  });

  it('rotates a webhook secret, and lets auditors look but not change', async () => {
    const created = (await app.inject({ method: 'POST', url: '/v1/log-export/destinations', payload: { kind: 'webhook', name: 'SIEM', url: 'https://hooks.acme.example/in', recordTypes: ['decisions'] } })).json();
    const rotated = (await app.inject({ method: 'POST', url: `/v1/log-export/destinations/${created.destination.destinationId}/rotate-secret` })).json();
    expect(rotated.signingSecret).not.toBe(created.signingSecret);
    role = 'tenant_auditor';
    expect((await app.inject({ method: 'GET', url: '/v1/log-export' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/v1/log-export/destinations/${created.destination.destinationId}/test` })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/v1/log-export/destinations/${created.destination.destinationId}` })).statusCode).toBe(403);
    await new Promise((r) => setImmediate(r));
    const denied = (await app.inject({ method: 'GET', url: '/v1/activity?outcome=denied' })).json();
    expect(denied.items.map((i: any) => i.action).sort()).toEqual(['log_export.deleted', 'log_export.tested']);
    expect(denied.items[0].actor.role).toBe('tenant_auditor');
  });

  it('lists, resends and discards dead letters', async () => {
    const created = (await app.inject({ method: 'POST', url: '/v1/log-export/destinations', payload: { kind: 'webhook', name: 'SIEM', url: 'https://hooks.acme.example/in', recordTypes: ['decisions'] } })).json();
    const store = new DestinationStore(secrets, 'test');
    for (const entryId of ['dl1000a', 'dl2000b']) {
      await store.addDeadLetter({
        tenantId: T, recordKey: `dead#${entryId}`, entryId, destinationId: created.destination.destinationId, destinationName: 'SIEM', source: 'decisions',
        records: [fromDecision(decision(1))], count: 1, error: 'The destination answered 503', attempts: 5, firstAttemptAt: 'x', lastAttemptAt: 'y', ttl: Math.floor(Date.now() / 1000) + 86_400,
      });
    }
    const list = (await app.inject({ method: 'GET', url: '/v1/log-export/dead-letters' })).json();
    expect(list.items.map((i: any) => i.entryId)).toEqual(['dl2000b', 'dl1000a']);
    expect(list.items[0]).toMatchObject({ count: 1, types: ['decision'], error: 'The destination answered 503' });
    expect(list.items[0].records).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/v1/log-export/dead-letters/dl1000a' })).json().records).toHaveLength(1);

    const retried = await app.inject({ method: 'POST', url: '/v1/log-export/dead-letters/dl1000a/retry' });
    expect(retried.json()).toMatchObject({ ok: true, message: 'Delivered 1 records' });
    expect((await app.inject({ method: 'DELETE', url: '/v1/log-export/dead-letters/dl2000b' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/log-export/dead-letters' })).json().items).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/v1/log-export' })).json().destinations[0].deliveredCount).toBe(1);
  });
});
