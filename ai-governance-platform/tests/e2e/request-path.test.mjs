// End-to-end tests of the request path: a real app request goes through the gateway, the policy engine,
// data protection and the (mock) model, and leaves an audit record. Nothing is replaced by a stand-in.
//
// Needs the local stack: scripts/dev-local.sh start. Run with: npm run test:e2e
// The suite creates two tenants of its own ("E2E tenant A/B"), reuses them on later runs, and removes the
// rules and API keys it creates. It also starts a second gateway on :3100 whose policy engine and data
// protection addresses point at nothing, to test what happens when those checks are down.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3000';
const MOCK = process.env.MOCK_LLM_URL || 'http://localhost:4010';
const DEGRADED_PORT = 3100;
const DEGRADED = `http://localhost:${DEGRADED_PORT}`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODEL = 'gpt-4o-mini';

const platform = { authorization: 'Bearer test-key', 'x-tenant-id': 'tenant_platform', 'x-dev-role': 'platform_admin' };
const adminOf = (tenantId) => ({ authorization: 'Bearer test-key', 'x-tenant-id': tenantId, 'x-dev-role': 'tenant_admin' });

async function call(method, url, { headers = {}, body, base = GATEWAY } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

/** A word no regex will mistake for personal data, used to find this request at the model. */
function marker() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return 'zq' + Array.from({ length: 10 }, () => letters[Math.floor(Math.random() * 26)]).join('');
}

const chat = (key, content, { model = MODEL, base, headers = {} } = {}) =>
  call('POST', '/v1/chat/completions', {
    base,
    headers: { authorization: `Bearer ${key}`, 'x-app-id': 'e2e-suite', 'x-user-id': 'e2e-user', ...headers },
    body: { model, messages: [{ role: 'user', content }] },
  });

/** A streamed chat request; returns the raw events and the text they add up to. */
async function streamChat(key, content, { abortAfterChunks, url = '/v1/chat/completions', body } = {}) {
  const ac = new AbortController();
  const res = await fetch(GATEWAY + url, {
    method: 'POST',
    signal: ac.signal,
    headers: { 'content-type': 'application/json', ...(url.includes('/proxy/') ? { 'x-probaline-key': key, authorization: 'Bearer sk-dev-own' } : { authorization: `Bearer ${key}` }), 'x-app-id': 'e2e-suite' },
    body: JSON.stringify(body ?? { model: MODEL, stream: true, stream_options: { include_usage: true }, messages: [{ role: 'user', content }] }),
  });
  if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) return { status: res.status, headers: res.headers, json: await res.json(), events: [], text: '' };
  const events = [];
  let buf = '';
  const decoder = new TextDecoder();
  try {
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const ev = buf.slice(0, i); buf = buf.slice(i + 2);
        if (ev.startsWith('data: ')) events.push(ev.slice(6));
      }
      if (abortAfterChunks && events.length >= abortAfterChunks) { ac.abort(); break; }
    }
  } catch (e) { if (e.name !== 'AbortError') throw e; }
  const parsed = events.filter((e) => e !== '[DONE]').map((e) => JSON.parse(e));
  const text = parsed.map((p) => p.choices?.[0]?.delta?.content ?? '').join('');
  return { status: res.status, headers: res.headers, events, parsed, text };
}

/** What the mock model received for prompts containing this marker. */
const atModel = async (m) => (await fetch(`${MOCK}/_received?contains=${m}`)).json();

const caseFile = (tenantId, requestId) => call('GET', `/v1/evidence/${encodeURIComponent(requestId)}`, { headers: adminOf(tenantId) });

/** The request ID an app gets back, from a success (OpenAI `id`) or an error body. */
const idOf = (res) => res.body?.id ?? res.body?.requestId;

// ---------------------------------------------------------------------------------------------------------
// Setup

const created = { rules: [], keys: [] };
let A; let B; // tenant IDs
let keyA; let keyB; // raw API keys
let degraded; // child process

async function ensureTenant(name, adminEmail) {
  const list = await call('GET', '/v1/tenants', { headers: platform });
  assert.equal(list.status, 200, 'platform admin can list tenants');
  const found = list.body.find((t) => t.name === name);
  if (found) {
    if (found.status !== 'active') await call('POST', `/v1/tenants/${found.tenantId}/activate`, { headers: platform });
    return found.tenantId;
  }
  const res = await call('POST', '/v1/tenants', { headers: platform, body: { name, adminEmail, plan: 'starter' } });
  assert.equal(res.status, 201, `create ${name}: ${JSON.stringify(res.body)}`);
  return res.body.tenantId;
}

async function ensureModel(tenantId) {
  const list = await call('GET', '/v1/models/config', { headers: adminOf(tenantId) });
  if (Array.isArray(list.body) && list.body.some((m) => m.modelId === MODEL)) return;
  const res = await call('POST', '/v1/models/config', {
    headers: adminOf(tenantId),
    body: { name: 'GPT-4o mini (local mock)', provider: 'openai', modelId: MODEL, apiKey: 'sk-local-mock-0000', inputCostPer1kTokens: 0.00015, outputCostPer1kTokens: 0.0006 },
  });
  assert.ok(res.status < 300, `model config: ${JSON.stringify(res.body)}`);
}

async function newKey(tenantId, name = 'e2e-app') {
  const res = await call('POST', '/v1/api-keys', { headers: adminOf(tenantId), body: { name, scopes: ['chat'] } });
  assert.equal(res.status, 201, `api key: ${JSON.stringify(res.body)}`);
  created.keys.push({ tenantId, keyId: res.body.keyId });
  return res.body;
}

async function addRule(tenantId, rule) {
  const res = await call('POST', '/v1/rules', { headers: adminOf(tenantId), body: rule });
  assert.equal(res.status, 201, `add rule: ${JSON.stringify(res.body)}`);
  const view = (await call('GET', '/v1/rules', { headers: adminOf(tenantId) })).body.rules.find((r) => r.ruleId === res.body.ruleId);
  const ref = { tenantId, policyId: view.policyId, ruleId: res.body.ruleId };
  created.rules.push(ref);
  return ref;
}

const setRule = (ref, change) => call('PATCH', `/v1/rules/${ref.policyId}/${ref.ruleId}`, { headers: adminOf(ref.tenantId), body: change });
const setFailMode = (tenantId, mode) => call('PUT', '/v1/gateway/settings', { headers: adminOf(tenantId), body: { governanceFailMode: mode } });
const setSecrets = (tenantId, action) => call('PUT', '/v1/gateway/settings', { headers: adminOf(tenantId), body: { secretsAction: action } });
// Built at runtime so this file doesn't itself trip secret scanners.
const AWS_KEY = ['AKIA', 'Q3EGRV7XKZ2PLM4N'].join('');
const GH_TOKEN = ['ghp_', 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6'].join('');

/** A gateway whose policy engine and data protection addresses point at nothing. */
async function startDegradedGateway() {
  const env = {
    ...process.env,
    // Same as scripts/dev-local.sh
    AWS_ENDPOINT_URL: 'http://localhost:4566', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_REGION: 'us-east-1', STAGE: 'dev',
    AUDIT_LOG_BUCKET: 'ai-gov-audit-logs-dev-000000000000', POLICIES_TABLE: 'ai-gov-policies-dev', METRICS_TABLE: 'ai-gov-metrics-dev',
    COMPLIANCE_TABLE: 'ai-gov-compliance-dev', AUDIT_LOGS_TABLE: 'ai-gov-audit-logs-dev',
    AUTH_DEV_MODE: 'true', OPENAI_BASE_URL: `${MOCK}/v1`, GLOBAL_RATE_LIMIT: '2000',
    PORT: String(DEGRADED_PORT),
    POLICY_ENGINE_URL: 'http://127.0.0.1:9', DATA_PROTECTION_URL: 'http://127.0.0.1:9',
  };
  const child = spawn('npx', ['ts-node', '--transpile-only', '-r', 'tsconfig-paths/register', 'src/index.ts'], {
    cwd: path.join(ROOT, 'services/gateway'), env, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${DEGRADED}/health`)).ok) return child; } catch {}
    if (child.exitCode !== null) throw new Error(`degraded gateway exited: ${stderr.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  child.kill();
  throw new Error(`degraded gateway did not start: ${stderr.slice(-2000)}`);
}

before(async () => {
  const health = await fetch(`${GATEWAY}/health`).catch(() => null);
  assert.ok(health?.ok, `gateway not running at ${GATEWAY}; start it with scripts/dev-local.sh start`);
  const mock = await fetch(`${MOCK}/_received?contains=x`).catch(() => null);
  assert.ok(mock?.ok, `mock model at ${MOCK} doesn't support /_received; restart it (scripts/dev-local.sh stop && start)`);

  A = await ensureTenant('E2E tenant A', 'e2e-a@example.com');
  B = await ensureTenant('E2E tenant B', 'e2e-b@example.com');
  await Promise.all([ensureModel(A), ensureModel(B)]);
  keyA = (await newKey(A)).key;
  keyB = (await newKey(B)).key;
  await setFailMode(A, 'closed');
  await setFailMode(B, 'closed');
  await setSecrets(A, 'block');
  await setSecrets(B, 'block');
});

after(async () => {
  degraded?.kill();
  for (const r of created.rules) await call('DELETE', `/v1/rules/${r.policyId}/${r.ruleId}`, { headers: adminOf(r.tenantId) });
  for (const k of created.keys) await call('DELETE', `/v1/api-keys/${k.keyId}`, { headers: adminOf(k.tenantId) });
  if (A) { await setFailMode(A, 'closed'); await setSecrets(A, 'block'); }
  if (B) {
    await setFailMode(B, 'closed');
    await call('POST', `/v1/tenants/${B}/activate`, { headers: platform });
  }
});

// ---------------------------------------------------------------------------------------------------------
// Scenarios

describe('a clean prompt', () => {
  test('is answered in the OpenAI format, reaches the model unchanged, and is recorded as delivered', async () => {
    const m = marker();
    const prompt = `Summarise our onboarding checklist ${m}`;
    const res = await chat(keyA, prompt);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.object, 'chat.completion', 'response uses the OpenAI chat.completion shape');
    assert.equal(typeof res.body.choices?.[0]?.message?.content, 'string', 'answer is in choices[0].message.content');
    assert.ok(res.body.usage?.total_tokens > 0, 'usage is reported');

    const seen = await atModel(m);
    assert.equal(seen.length, 1, 'model received the prompt once');
    assert.equal(seen[0].prompt, prompt, 'prompt reached the model unchanged');

    const record = await caseFile(A, idOf(res));
    assert.equal(record.status, 200, `case file for ${idOf(res)}: ${JSON.stringify(record.body)}`);
    assert.equal(record.body.outcome, 'delivered');
    assert.equal(record.body.app, 'e2e-suite');
  });
});

describe('personal data', () => {
  test('is removed before the prompt reaches the model, and the record says so', async () => {
    const m = marker();
    const res = await chat(keyA, `Email john.smith@acme-corp.com or call 415-555-0199 about card 4111 1111 1111 1111 ${m}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const [seen] = await atModel(m);
    assert.ok(seen, 'model received the request');
    for (const secret of ['john.smith@acme-corp.com', '415-555-0199', '4111 1111 1111 1111']) {
      assert.ok(!seen.prompt.includes(secret), `model must not see "${secret}"; it saw: ${seen.prompt}`);
    }

    const record = await caseFile(A, idOf(res));
    assert.equal(record.body.outcome, 'cleaned');
  });

  test('in the model’s reply is removed before the app sees it', async () => {
    const res = await chat(keyA, `MOCK_REPLY_WITH_PII ${marker()}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const answer = res.body.choices?.[0]?.message?.content ?? '';
    assert.ok(answer.length > 0, 'got an answer');
    assert.ok(!answer.includes('jane.doe@example.com'), `reply email leaked: ${answer}`);
    assert.ok(!answer.includes('415-555-0134'), `reply phone leaked: ${answer}`);
  });
});

describe('rules', () => {
  test('a blocked-word rule stops the prompt before the model, and the app can find the case file', async () => {
    const word = marker();
    const rule = await addRule(A, { type: 'keyword_block', description: `E2E blocked word ${word}`, values: [word] });
    const m = marker();
    const res = await chat(keyA, `Please review the ${word} plan ${m}`);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, 'POLICY_VIOLATION');
    assert.deepEqual(await atModel(m), [], 'model never received a stopped prompt');

    const record = await caseFile(A, idOf(res));
    assert.equal(record.status, 200, `the request ID given to the app (${idOf(res)}) opens its case file`);
    assert.equal(record.body.outcome, 'stopped');
    assert.ok(record.body.proof.triggeredRules.length > 0, 'the record names the rule');

    // Turning the rule off takes effect on the next request.
    assert.equal((await setRule(rule, { enabled: false })).status, 200);
    const again = await chat(keyA, `Please review the ${word} plan ${marker()}`);
    assert.equal(again.status, 200, `after turning the rule off: ${JSON.stringify(again.body)}`);
  });

  test('a rule only applies to its own tenant', async () => {
    const word = marker();
    await addRule(A, { type: 'keyword_block', description: `E2E A-only ${word}`, values: [word] });
    const res = await chat(keyB, `Tenant B may say ${word}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test('an approved-models rule refuses other models', async () => {
    const rule = await addRule(A, { type: 'model_restriction', description: 'E2E approved models', values: [MODEL] });
    const m = marker();
    const refused = await chat(keyA, `hello ${m}`, { model: 'gpt-4o' });
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.equal(refused.body.code, 'POLICY_VIOLATION');
    assert.deepEqual(await atModel(m), []);

    const allowed = await chat(keyA, `hello ${marker()}`);
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    await setRule(rule, { enabled: false });
  });

  test('a personal-data rule can stop a prompt outright instead of cleaning it', async () => {
    const rule = await addRule(A, { type: 'pii_detection', description: 'E2E no SSNs', values: ['SSN'] });
    const m = marker();
    const res = await chat(keyA, `My SSN is 123-45-6789 ${m}`);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.deepEqual(await atModel(m), []);
    await setRule(rule, { enabled: false });
  });
});

describe('secrets', () => {
  test('a prompt with a cloud key is stopped before the model, and nothing keeps the key', async () => {
    const m = marker();
    const res = await chat(keyA, `Why is ${AWS_KEY} getting AccessDenied? ${m}`);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, 'SECRET_DETECTED');
    assert.match(res.body.message, /AWS access key/);
    assert.ok(!JSON.stringify(res.body).includes(AWS_KEY), 'the error does not echo the key');
    assert.deepEqual(await atModel(m), [], 'model never received the key');

    const record = await caseFile(A, idOf(res));
    assert.equal(record.status, 200, JSON.stringify(record.body));
    assert.equal(record.body.outcome, 'stopped');
    assert.ok(record.body.steps.some((st) => st.label === 'Stopped: secret in the prompt'), JSON.stringify(record.body.steps));
    assert.ok(!JSON.stringify(record.body).includes(AWS_KEY), 'the case file does not contain the key');

    const stopped = await call('GET', '/v1/gateway/stopped', { headers: adminOf(A) });
    assert.ok(stopped.body.byCheck.secrets.active, 'the check reports as active');
    assert.ok(stopped.body.byCheck.secrets.stopped >= 1, 'the stop is counted on the secrets check');
  });

  test('a company that chose remove-then-send gets the prompt delivered without the secret', async () => {
    assert.equal((await setSecrets(A, 'redact')).status, 200);
    try {
      const m = marker();
      const res = await chat(keyA, `Clone with ${GH_TOKEN} and email ops@acme-corp.com ${m}`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const [seen] = await atModel(m);
      assert.ok(seen, 'model received the request');
      assert.ok(!seen.prompt.includes(GH_TOKEN), `model must not see the token; it saw: ${seen.prompt}`);
      assert.ok(seen.prompt.includes('[REDACTED github_token]'), `the token is replaced by a marker: ${seen.prompt}`);
      assert.ok(!seen.prompt.includes('ops@acme-corp.com'), 'personal data is still removed after secrets');

      const record = await caseFile(A, idOf(res));
      assert.equal(record.body.outcome, 'cleaned');
      assert.ok(record.body.steps.some((st) => st.label === 'Secrets removed'), JSON.stringify(record.body.steps));
    } finally {
      await setSecrets(A, 'block');
    }
  });

  test('IDE traffic is checked too, and redacted before it is forwarded', async () => {
    const proxy = (content) => call('POST', '/v1/proxy/openai/v1/chat/completions', {
      headers: { 'x-probaline-key': keyA, authorization: 'Bearer sk-developer-own-key' },
      body: { model: MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: content }] }] },
    });
    const m1 = marker();
    const blocked = await proxy(`deploy using ${AWS_KEY} ${m1}`);
    assert.equal(blocked.status, 403, JSON.stringify(blocked.body));
    assert.equal(blocked.body.code, 'SECRET_DETECTED');
    assert.deepEqual(await atModel(m1), []);

    assert.equal((await setSecrets(A, 'redact')).status, 200);
    try {
      const m2 = marker();
      const sent = await proxy(`deploy using ${AWS_KEY} ${m2}`);
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      const [seen] = await atModel(m2);
      assert.ok(seen && !seen.prompt.includes(AWS_KEY), `forwarded body still had the key: ${seen?.prompt}`);
    } finally {
      await setSecrets(A, 'block');
    }
  });

  test('a blocked prompt never starts a stream', async () => {
    const m = marker();
    const res = await call('POST', '/v1/chat/completions', {
      headers: { authorization: `Bearer ${keyA}` },
      body: { model: MODEL, stream: true, messages: [{ role: 'user', content: `here is my key ${AWS_KEY} ${m}` }] },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'SECRET_DETECTED');
    assert.deepEqual(await atModel(m), []);
  });

  test('ordinary prompts about keys and passwords are not stopped', async () => {
    const prompt = 'What should our password policy say? Use AKIAIOSFODNN7EXAMPLE in docs, and password=${DB_PASSWORD} in config. ' + marker();
    const res = await chat(keyA, prompt);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
});

describe('who can call', () => {
  test('no key, a made-up key and a revoked key are refused', async () => {
    const none = await call('POST', '/v1/chat/completions', { body: { model: MODEL, messages: [{ role: 'user', content: 'hi' }] } });
    assert.equal(none.status, 401);

    const fake = await chat('pbl_not_a_real_key_000000000000', 'hi');
    assert.equal(fake.status, 401);
    assert.equal(fake.body.code, 'INVALID_KEY');

    const temp = await newKey(A, 'e2e-revoked');
    assert.equal((await chat(temp.key, `works ${marker()}`)).status, 200, 'new key works');
    assert.equal((await call('POST', `/v1/api-keys/${temp.keyId}/revoke`, { headers: adminOf(A) })).status, 200);
    const after = await chat(temp.key, `revoked ${marker()}`);
    assert.equal(after.status, 401, `revoked key must stop working at once: ${JSON.stringify(after.body)}`);
  });

  test('a key cannot act for another tenant', async () => {
    const res = await chat(keyA, 'hi', { headers: { 'x-tenant-id': B } });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'TENANT_MISMATCH');
  });

  test('a key cannot read audit records', async () => {
    const res = await call('GET', '/v1/evidence', { headers: { authorization: `Bearer ${keyA}` } });
    assert.equal(res.status, 403);
  });

  test('a suspended tenant is refused at once, and works again when reactivated', async () => {
    assert.equal((await call('POST', `/v1/tenants/${B}/suspend`, { headers: platform })).status, 200);
    const m = marker();
    const res = await chat(keyB, `hello ${m}`);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, 'TENANT_SUSPENDED');
    assert.deepEqual(await atModel(m), []);

    assert.equal((await call('POST', `/v1/tenants/${B}/activate`, { headers: platform })).status, 200);
    assert.equal((await chat(keyB, `hello ${marker()}`)).status, 200);
  });
});

describe('IDE traffic (proxy mode)', () => {
  const proxy = (key, content) => call('POST', '/v1/proxy/openai/v1/chat/completions', {
    headers: { 'x-probaline-key': key, authorization: 'Bearer sk-developer-own-key' },
    body: { model: MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: content }] }] },
  });

  test('is checked against the same rules', async () => {
    const word = marker();
    await addRule(A, { type: 'keyword_block', description: `E2E proxy word ${word}`, values: [word] });
    const m = marker();
    const res = await proxy(keyA, `refactor the ${word} module ${m}`);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, 'POLICY_VIOLATION');
    assert.deepEqual(await atModel(m), []);
    assert.equal((await caseFile(A, res.body.requestId)).body.outcome, 'stopped');
  });

  test('is forwarded unchanged when allowed', async () => {
    const m = marker();
    const res = await proxy(keyA, `explain this function ${m}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.headers.get('x-probaline-request-id'), 'response carries the Probaline request ID');
    assert.equal((await atModel(m)).length, 1);
  });
});

describe('streaming', () => {
  test('answers as OpenAI server-sent events, and the case file is written when it ends', async () => {
    const m = marker();
    const r = await streamChat(keyA, `Stream please ${m}`);
    assert.equal(r.status, 200);
    assert.equal(r.events.at(-1), '[DONE]');
    assert.ok(r.parsed.every((p) => p.object === 'chat.completion.chunk'));
    assert.equal(r.text, 'Mock reply to a 3-word prompt.');
    assert.equal(r.parsed.find((p) => p.usage)?.usage.total_tokens > 0, true, 'usage sent when asked for');
    const id = r.headers.get('x-probaline-request-id');
    assert.equal(r.parsed[0].id, id);
    await new Promise((res) => setTimeout(res, 200));
    const record = await caseFile(A, id);
    assert.equal(record.status, 200, JSON.stringify(record.body));
    assert.equal(record.body.outcome, 'delivered');
  });

  test('removes personal data from the answer even when it is split across chunks', async () => {
    const r = await streamChat(keyA, `MOCK_REPLY_WITH_PII ${marker()}`);
    assert.equal(r.status, 200);
    assert.ok(r.text.length > 10, r.text);
    assert.ok(!r.text.includes('jane.doe@example.com'), r.text);
    assert.ok(!r.text.includes('415-555-0134'), r.text);
  });

  test('a blocked prompt never starts a stream', async () => {
    const word = marker();
    await addRule(A, { type: 'keyword_block', description: `E2E stream word ${word}`, values: [word] });
    const m = marker();
    const r = await streamChat(keyA, `about ${word} ${m}`);
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'POLICY_VIOLATION');
    assert.deepEqual(await atModel(m), []);
  });

  test('an app that leaves mid-answer still gets a case file', async () => {
    const r = await streamChat(keyA, `MOCK_SLOW_STREAM ${marker()}`, { abortAfterChunks: 3 });
    const id = r.headers.get('x-probaline-request-id');
    await new Promise((res) => setTimeout(res, 500));
    const record = await caseFile(A, id);
    assert.equal(record.status, 200, JSON.stringify(record.body));
  });

  test('proxy mode streams the provider’s answer straight through', async () => {
    const m = marker();
    const r = await streamChat(keyA, '', { url: '/v1/proxy/openai/v1/chat/completions', body: { model: MODEL, stream: true, messages: [{ role: 'user', content: `explain ${m}` }] } });
    assert.equal(r.status, 200);
    assert.equal(r.events.at(-1), '[DONE]');
    assert.equal(r.text, 'Mock reply to a 2-word prompt.');
    assert.equal((await atModel(m)).length, 1);
  });
});

describe('when the checks are down', () => {
  before(async () => {
    await setFailMode(A, 'closed');
    await setFailMode(B, 'open');
    degraded = await startDegradedGateway();
  });

  test('a fail-closed tenant is refused and nothing reaches the model', async () => {
    const m = marker();
    const res = await chat(keyA, `hello ${m}`, { base: DEGRADED });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(res.body.code, 'GOVERNANCE_UNAVAILABLE');
    assert.deepEqual(await atModel(m), []);
  });

  test('a fail-open tenant is answered, and the record says the checks were skipped', async () => {
    const res = await chat(keyB, `hello ${marker()}`, { base: DEGRADED });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const record = await caseFile(B, idOf(res));
    assert.equal(record.status, 200);
    const skipped = record.body.steps.filter((s) => s.kind === 'skipped').map((s) => s.label);
    assert.ok(skipped.includes('Policy rules skipped'), `steps: ${skipped}`);
    assert.ok(skipped.includes('Personal data not checked'), `steps: ${skipped}`);
  });
});
