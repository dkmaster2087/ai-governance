// End-to-end tests of the admin activity trail and log export: real admin changes, a refused API key and a
// real AI request leave records, and the gateway's sender delivers them to a local collector as a signed
// webhook, Splunk HEC events and OTLP/HTTP logs, retries a failing destination and sets the batch aside.
//
// Needs the local stack: scripts/dev-local.sh start (or --postgres). It sets the LOG_EXPORT_* switches that
// let the gateway send to http://127.0.0.1 and send quickly. Run with: npm run test:e2e
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3000';
const MODEL = 'gpt-4o-mini';
const platform = { authorization: 'Bearer test-key', 'x-tenant-id': 'tenant_platform', 'x-dev-role': 'platform_admin' };
const as = (tenantId, role = 'tenant_admin', userId = 'e2e-admin') => ({ authorization: 'Bearer test-key', 'x-tenant-id': tenantId, 'x-dev-role': role, 'x-user-id': userId });

async function call(method, url, { headers = {}, body } = {}) {
  const res = await fetch(GATEWAY + url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, check, ms = 60_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await wait(500);
  }
}

// ── A local collector that speaks all three formats ─────────────────────────────────────────────────

const got = { webhook: [], splunk: [], otlp: [] };
let flaky = true;
let collector;
let base;

function startCollector() {
  return new Promise((resolve) => {
    collector = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const entry = { headers: req.headers, body, path: req.url };
        if (req.url.startsWith('/flaky')) {
          if (flaky) { res.writeHead(503); return res.end('collector down'); }
          got.webhook.push(entry);
        } else if (req.url.startsWith('/hook')) got.webhook.push(entry);
        else if (req.url.startsWith('/services/collector/event')) got.splunk.push(entry);
        else if (req.url.startsWith('/v1/logs')) got.otlp.push(entry);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"text":"Success","code":0}');
      });
    });
    collector.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${collector.address().port}`; resolve(); });
  });
}

const webhookRecords = () => got.webhook.flatMap((e) => JSON.parse(e.body).records ?? []);
const splunkRecords = () => got.splunk.flatMap((e) => e.body.split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const otlpRecords = () => got.otlp.flatMap((e) => JSON.parse(e.body).resourceLogs[0].scopeLogs[0].logRecords);

function verify(secret, entry) {
  const sig = entry.headers['x-probaline-signature'];
  const [t, v1] = sig.split(',').map((p) => p.split('=')[1]);
  return createHmac('sha256', secret).update(`${t}.${entry.body}`).digest('hex') === v1;
}

// ── Setup ────────────────────────────────────────────────────────────────────────────────────────

let A; let B;
const destinations = [];

async function ensureTenant(name, adminEmail) {
  const list = await call('GET', '/v1/tenants', { headers: platform });
  const found = list.body.find((t) => t.name === name);
  if (found) return found.tenantId;
  const res = await call('POST', '/v1/tenants', { headers: platform, body: { name, adminEmail, plan: 'starter' } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.tenantId;
}

async function addDestination(tenantId, body) {
  const res = await call('POST', '/v1/log-export/destinations', { headers: as(tenantId), body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  destinations.push({ tenantId, id: res.body.destination.destinationId });
  return res.body;
}

before(async () => {
  const health = await fetch(`${GATEWAY}/health`).catch(() => null);
  assert.ok(health?.ok, `gateway not running at ${GATEWAY}; start it with scripts/dev-local.sh start`);
  await startCollector();
  A = await ensureTenant('E2E log export A', 'e2e-logs-a@example.com');
  B = await ensureTenant('E2E log export B', 'e2e-logs-b@example.com');
  // Leftovers from an interrupted run.
  for (const t of [A, B]) {
    for (const d of (await call('GET', '/v1/log-export', { headers: as(t) })).body.destinations ?? []) await call('DELETE', `/v1/log-export/destinations/${d.destinationId}`, { headers: as(t) });
  }
  const models = await call('GET', '/v1/models/config', { headers: as(A) });
  if (!(Array.isArray(models.body) && models.body.some((m) => m.modelId === MODEL))) {
    const res = await call('POST', '/v1/models/config', { headers: as(A), body: { name: 'GPT-4o mini (local mock)', provider: 'openai', modelId: MODEL, apiKey: 'sk-local-mock-0000', inputCostPer1kTokens: 0.00015, outputCostPer1kTokens: 0.0006 } });
    assert.ok(res.status < 300, JSON.stringify(res.body));
  }
});

after(async () => {
  for (const d of destinations) await call('DELETE', `/v1/log-export/destinations/${d.id}`, { headers: as(d.tenantId) });
  for (const t of [A, B]) {
    for (const dl of (await call('GET', '/v1/log-export/dead-letters', { headers: as(t) })).body.items ?? []) await call('DELETE', `/v1/log-export/dead-letters/${dl.entryId}`, { headers: as(t) });
  }
  collector?.close();
});

// ── Scenarios ────────────────────────────────────────────────────────────────────────────────────

describe('admin activity and sign-ins', () => {
  test('changes are recorded with who and what; a revoked key is recorded when used; another company sees none of it', async () => {
    const key = await call('POST', '/v1/api-keys', { headers: as(A, 'tenant_admin', 'e2e-ana'), body: { name: 'e2e-log-key', scopes: ['chat'] } });
    assert.equal(key.status, 201);
    assert.equal((await call('POST', `/v1/api-keys/${key.body.keyId}/revoke`, { headers: as(A, 'tenant_admin', 'e2e-ana') })).status, 200);
    const refused = await call('POST', '/v1/chat/completions', { headers: { authorization: `Bearer ${key.body.key}` }, body: { model: MODEL, messages: [{ role: 'user', content: 'hi' }] } });
    assert.equal(refused.status, 401);
    // An auditor trying to change something is refused, and that is recorded too.
    assert.equal((await call('POST', '/v1/log-export/destinations', { headers: as(A, 'tenant_auditor', 'e2e-aud'), body: { kind: 'webhook', name: 'x', url: `${base}/hook`, recordTypes: ['decisions'] } })).status, 403);

    const items = await until('activity records', async () => {
      const r = await call('GET', '/v1/activity?limit=100', { headers: as(A, 'tenant_auditor') });
      const list = r.body.items ?? [];
      const ok = ['api_key.created', 'api_key.revoked', 'sign_in.api_key', 'log_export.created'].every((a) => list.some((i) => i.action === a && (a !== 'api_key.created' || i.target?.keyId === key.body.keyId)));
      return ok && list;
    });
    const created = items.find((i) => i.action === 'api_key.created' && i.target?.keyId === key.body.keyId);
    assert.deepEqual([created.category, created.outcome, created.actor.id, created.actor.role], ['admin', 'success', 'e2e-ana', 'tenant_admin']);
    assert.match(created.hash, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(created).includes(key.body.key), 'the raw key is never recorded');
    const signIn = items.find((i) => i.action === 'sign_in.api_key' && i.actor.keyId === key.body.keyId);
    assert.deepEqual([signIn.category, signIn.outcome, signIn.detail.reason], ['sign_in', 'denied', 'KEY_REVOKED']);
    const denied = items.find((i) => i.action === 'log_export.created' && i.outcome === 'denied');
    assert.equal(denied.actor.role, 'tenant_auditor');

    const signIns = await call('GET', '/v1/activity?category=sign_in', { headers: as(A) });
    assert.ok(signIns.body.items.every((i) => i.category === 'sign_in'));
    const other = await call('GET', '/v1/activity?limit=200', { headers: as(B) });
    assert.ok(!other.body.items.some((i) => i.target?.keyId === key.body.keyId), 'tenant B does not see tenant A');
    assert.equal((await call('GET', '/v1/activity', { headers: as(A, 'tenant_user') })).status, 403);
    await call('DELETE', `/v1/api-keys/${key.body.keyId}`, { headers: as(A) });
  });
});

describe('log export', () => {
  let secret;

  test('a webhook is signed, tested, and receives decisions, admin activity and sign-ins (never the prompt)', async () => {
    const created = await addDestination(A, { kind: 'webhook', name: 'E2E webhook', url: `${base}/hook`, recordTypes: ['decisions', 'admin_activity', 'sign_ins'] });
    secret = created.signingSecret;
    assert.match(secret, /^whsec_/);
    const view = (await call('GET', '/v1/log-export', { headers: as(A) })).body;
    assert.ok(!JSON.stringify(view).includes(secret), 'the secret is not shown again');

    const test = await call('POST', `/v1/log-export/destinations/${created.destination.destinationId}/test`, { headers: as(A) });
    assert.equal(test.body.ok, true, JSON.stringify(test.body));
    assert.ok(verify(secret, got.webhook.at(-1)), 'test batch signature checks out');
    assert.equal(webhookRecords().at(-1).type, 'test');

    // Traffic after the destination exists: an admin change, and an AI request with a word to look for.
    const key = await call('POST', '/v1/api-keys', { headers: as(A), body: { name: 'e2e-export-key', scopes: ['chat'] } });
    const marker = `zqexport${Date.now()}`;
    const chat = await call('POST', '/v1/chat/completions', { headers: { authorization: `Bearer ${key.body.key}`, 'x-app-id': 'e2e-export', 'x-user-id': 'e2e-user' }, body: { model: MODEL, messages: [{ role: 'user', content: `say ${marker}` }] } });
    assert.equal(chat.status, 200, JSON.stringify(chat.body));
    await call('POST', `/v1/api-keys/${key.body.keyId}/revoke`, { headers: as(A) });
    await call('POST', '/v1/chat/completions', { headers: { authorization: `Bearer ${key.body.key}` }, body: { model: MODEL, messages: [{ role: 'user', content: 'x' }] } });

    const records = await until('decision, admin and sign-in records at the webhook', () => {
      const r = webhookRecords();
      const ok = r.some((x) => x.type === 'decision' && x.requestId === chat.body.id)
        && r.some((x) => x.type === 'admin_activity' && x.action === 'api_key.created' && x.target?.keyId === key.body.keyId)
        && r.some((x) => x.type === 'sign_in' && x.action === 'sign_in.api_key' && x.actor.keyId === key.body.keyId);
      return ok && r;
    });
    const decision = records.find((x) => x.type === 'decision' && x.requestId === chat.body.id);
    assert.deepEqual([decision.schema, decision.action, decision.outcome, decision.tenantId, decision.actor.appId], ['probaline.log/1', 'ai.request', 'allowed', A, 'e2e-export']);
    assert.ok(got.webhook.every((e) => verify(secret, e)), 'every batch is signed');
    assert.ok(!got.webhook.some((e) => e.body.includes(marker)), 'the prompt never leaves');
    const ids = records.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, 'nothing sent twice');

    const after = (await call('GET', '/v1/log-export', { headers: as(A) })).body.destinations.find((d) => d.destinationId === created.destination.destinationId);
    assert.ok(after.deliveredCount >= 3);
    assert.ok(after.lastDeliveredAt);
    await call('DELETE', `/v1/api-keys/${key.body.keyId}`, { headers: as(A) });
  });

  test('Splunk HEC and OpenTelemetry destinations get the records in their own formats', async () => {
    await addDestination(A, { kind: 'splunk_hec', name: 'E2E Splunk', url: base, token: 'e2e-hec-token-0001', splunkIndex: 'probaline', recordTypes: ['admin_activity'] });
    await addDestination(A, { kind: 'otlp_http', name: 'E2E OTLP', otlpEncoding: 'json', url: base, headers: [{ name: 'DD-API-KEY', value: 'e2e-dd-key' }], recordTypes: ['admin_activity'] });
    const rule = await call('POST', '/v1/log-export/destinations', { headers: as(A), body: { kind: 'webhook', name: 'E2E short-lived', url: `${base}/hook`, recordTypes: ['decisions'] } });
    assert.equal(rule.status, 201);
    await call('DELETE', `/v1/log-export/destinations/${rule.body.destination.destinationId}`, { headers: as(A) });

    await until('Splunk events', () => splunkRecords().some((e) => e.event.action === 'log_export.deleted'));
    const s = got.splunk.at(-1);
    assert.equal(s.headers.authorization, 'Splunk e2e-hec-token-0001');
    const ev = splunkRecords().find((e) => e.event.action === 'log_export.deleted');
    assert.deepEqual([ev.sourcetype, ev.index, ev.source], ['probaline:admin_activity', 'probaline', 'probaline']);

    await until('OTLP logs', () => otlpRecords().some((l) => l.attributes.some((a) => a.key === 'probaline.action' && a.value.stringValue === 'log_export.deleted')));
    assert.equal(got.otlp.at(-1).headers['dd-api-key'], 'e2e-dd-key');
    assert.equal(got.otlp.at(-1).headers['content-type'], 'application/json');
    const lr = otlpRecords().find((l) => l.attributes.some((a) => a.value.stringValue === 'log_export.deleted'));
    assert.equal(JSON.parse(lr.body.stringValue).type, 'admin_activity');
    assert.match(lr.timeUnixNano, /^\d{19}$/);
  });

  test('a destination that is down is retried, then its batch waits in dead letters and can be sent again', async () => {
    flaky = true;
    const created = await addDestination(B, { kind: 'webhook', name: 'E2E flaky', url: `${base}/flaky`, recordTypes: ['admin_activity'] });
    await call('POST', '/v1/api-keys', { headers: as(B), body: { name: 'e2e-flaky-trigger', scopes: ['chat'] } }).then(async (k) => {
      await call('DELETE', `/v1/api-keys/${k.body.keyId}`, { headers: as(B) });
    });
    const retrying = await until('a retry', async () => {
      const d = (await call('GET', '/v1/log-export', { headers: as(B) })).body.destinations.find((x) => x.destinationId === created.destination.destinationId);
      return d?.retrying && d;
    });
    assert.match(retrying.lastError, /503: collector down/);

    const dead = await until('a dead letter', async () => {
      const r = await call('GET', '/v1/log-export/dead-letters', { headers: as(B) });
      return r.body.items?.find((i) => i.destinationId === created.destination.destinationId);
    }, 90_000);
    assert.ok(dead.count >= 1);
    assert.ok(dead.attempts >= 2);
    assert.match(dead.error, /503/);
    const full = await call('GET', `/v1/log-export/dead-letters/${dead.entryId}`, { headers: as(B) });
    assert.ok(full.body.records.length === dead.count);

    flaky = false;
    const retry = await call('POST', `/v1/log-export/dead-letters/${dead.entryId}/retry`, { headers: as(B) });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.ok(verify(created.signingSecret, got.webhook.at(-1)));
    const left = await call('GET', '/v1/log-export/dead-letters', { headers: as(B) });
    assert.ok(!left.body.items.some((i) => i.entryId === dead.entryId));
    // Tenant A can't see or touch tenant B's dead letters.
    assert.equal((await call('POST', `/v1/log-export/dead-letters/${dead.entryId}/retry`, { headers: as(A) })).status, 404);
  });

  test('addresses and inputs are checked; auditors can look but not change', async () => {
    const bad = await call('POST', '/v1/log-export/destinations', { headers: as(A), body: { kind: 'splunk_hec', name: 'no token', url: base, recordTypes: ['decisions'] } });
    assert.equal(bad.status, 400);
    const creds = await call('POST', '/v1/log-export/destinations', { headers: as(A), body: { kind: 'webhook', name: 'x', url: 'https://user:pass@example.com/in', recordTypes: ['decisions'] } });
    assert.equal(creds.status, 400);
    assert.equal((await call('GET', '/v1/log-export', { headers: as(A, 'tenant_auditor') })).status, 200);
    const id = destinations.find((d) => d.tenantId === A).id;
    assert.equal((await call('DELETE', `/v1/log-export/destinations/${id}`, { headers: as(A, 'tenant_auditor') })).status, 403);
    assert.equal((await call('DELETE', `/v1/log-export/destinations/${id}`, { headers: as(B) })).status, 404);
  });
});
