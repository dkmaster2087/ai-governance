#!/usr/bin/env node
/**
 * Load test of the request path: how long Probaline's checks add to an AI request, and how many requests a
 * gateway handles, against the stand-in model (so the model's own time is near zero and constant).
 *
 *   node scripts/load-test.mjs [--seconds 30] [--concurrency 20] [--gateway http://localhost:3000] [--json out.json]
 *
 * Needs the local stack, with the per-address limit raised: GLOBAL_RATE_LIMIT=10000000 scripts/dev-local.sh start. Uses the local development sign-in to set up one test
 * company with a model, an API key, a few rules and an MCP server, then runs, one after the other:
 *   1. baseline       the stand-in model directly (what the network and the model cost on their own)
 *   2. chat           clean prompts through the gateway: rules, secrets, personal data, model, case file
 *   3. chat-pii       prompts with personal data (masked before the model, so data protection does real work)
 *   4. stopped        prompts a rule stops (no model call)
 *   5. mcp            MCP tool calls (arguments checked, an API called, the result filtered, a case file)
 * and reports requests per second, p50/p95/p99 latency, errors, and the time added over the baseline.
 * Results depend on the machine; record them with the hardware they came from.
 */
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const SECONDS = Number(arg('seconds', 20));
const CONCURRENCY = Number(arg('concurrency', 20));
const GATEWAY = arg('gateway', 'http://localhost:3000');
const MOCK = arg('mock', 'http://localhost:4010');
const MODEL = 'gpt-4o-mini';
const TENANT_NAME = 'Load test';
const platform = { authorization: 'Bearer test-key', 'x-tenant-id': 'tenant_platform', 'x-dev-role': 'platform_admin' };
const adminOf = (t) => ({ authorization: 'Bearer test-key', 'x-tenant-id': t, 'x-dev-role': 'tenant_admin' });

const agent = new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY * 2 });
function call(base, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, base);
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(u, { method, agent, headers: { ...headers, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let out = ''; res.on('data', (c) => (out += c));
      res.on('end', () => { let json = null; try { json = JSON.parse(out); } catch { /* not JSON */ } resolve({ status: res.statusCode, body: json }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function setUp() {
  const list = await call(GATEWAY, 'GET', '/v1/tenants', { headers: platform });
  if (list.status !== 200) throw new Error(`Can't reach the gateway's admin API (${list.status}); is the local stack running?`);
  let tenantId = list.body.find((t) => t.name === TENANT_NAME)?.tenantId;
  if (!tenantId) tenantId = (await call(GATEWAY, 'POST', '/v1/tenants', { headers: platform, body: { name: TENANT_NAME, adminEmail: 'load@example.com', plan: 'enterprise' } })).body.tenantId;
  const admin = adminOf(tenantId);
  const models = (await call(GATEWAY, 'GET', '/v1/models/config', { headers: admin })).body;
  if (!models.some((m) => m.modelId === MODEL)) {
    await call(GATEWAY, 'POST', '/v1/models/config', { headers: admin, body: { name: 'Mock', provider: 'openai', modelId: MODEL, apiKey: 'sk-local-mock-0000' } });
  }
  // One key per scenario: each key allows 10,000 calls a minute.
  const keys = [];
  const newKey = async () => {
    const made = await call(GATEWAY, 'POST', '/v1/api-keys', { headers: admin, body: { name: `load-${Date.now()}-${keys.length}`, scopes: ['chat', 'mcp'], rateLimit: 10_000 } });
    if (made.status !== 201) throw new Error(`Couldn't create an API key: ${JSON.stringify(made.body)}`);
    keys.push(made.body.keyId);
    return made.body.key;
  };
  // Rules a real company has: a word list, a pattern and a personal-data rule set to stop.
  const rules = (await call(GATEWAY, 'GET', '/v1/rules', { headers: admin })).body;
  if (!JSON.stringify(rules).includes('Load test words')) {
    await call(GATEWAY, 'POST', '/v1/rules', { headers: admin, body: { type: 'keyword_block', description: 'Load test words', values: ['project-nightjar', 'acquisition target'] } });
    await call(GATEWAY, 'POST', '/v1/rules', { headers: admin, body: { type: 'data_classification', description: 'Load test pattern', values: ['INTERNAL-[0-9]{6}'] } });
  }
  // An MCP server in front of a local stand-in API.
  const api = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: req.url.split('/').pop(), name: 'Jane Doe', email: 'jane.doe@acme.example', team: 'Finance' })); });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const spec = JSON.stringify({ openapi: '3.0.3', info: { title: 'People', version: '1' }, paths: { '/people/{id}': { get: { operationId: 'getPerson', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] } } } });
  const server = (await call(GATEWAY, 'POST', '/v1/mcp/servers', { headers: admin, body: { name: `Load ${Date.now()}` } })).body;
  await call(GATEWAY, 'POST', `/v1/mcp/servers/${server.serverId}/apis`, { headers: admin, body: { name: 'People', baseUrl: `http://127.0.0.1:${api.address().port}`, openapi: spec, auth: { type: 'none' } } });
  await call(GATEWAY, 'PATCH', `/v1/mcp/servers/${server.serverId}`, { headers: admin, body: { limits: { callsPerMinute: 10_000, maxResultBytes: 100_000 } } });
  await call(GATEWAY, 'POST', `/v1/mcp/servers/${server.serverId}/publish`, { headers: admin });
  return { tenantId, admin, newKey, keys, serverId: server.serverId, api };
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

async function run(name, once) {
  const latencies = []; let errors = 0; const statuses = {};
  const end = Date.now() + SECONDS * 1000;
  const worker = async () => {
    while (Date.now() < end) {
      const t = process.hrtime.bigint();
      try {
        const r = await once();
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
        if (!r.ok) errors++;
      } catch { errors++; statuses.error = (statuses.error ?? 0) + 1; }
      latencies.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  latencies.sort((a, b) => a - b);
  if (errors > latencies.length / 10) {
    console.error(`${name}: ${errors} of ${latencies.length} requests failed ${JSON.stringify(statuses)}. Results would be meaningless.`);
    if (statuses[429]) console.error('429: a limit was reached. The per-address limit needs GLOBAL_RATE_LIMIT=10000000 scripts/dev-local.sh start; keys and MCP callers allow 10,000 a minute, so keep runs under that rate.');
    process.exit(1);
  }
  const r = { name, requests: latencies.length, perSecond: +(latencies.length / SECONDS).toFixed(1), p50: +pct(latencies, 50).toFixed(1), p95: +pct(latencies, 95).toFixed(1), p99: +pct(latencies, 99).toFixed(1), errors, statuses };
  console.log(`${name.padEnd(9)} ${String(r.perSecond).padStart(7)} req/s   p50 ${String(r.p50).padStart(6)} ms   p95 ${String(r.p95).padStart(6)} ms   p99 ${String(r.p99).padStart(6)} ms   errors ${errors}  ${JSON.stringify(statuses)}`);
  return r;
}

const s = await setUp();
const chatBody = (content) => ({ model: MODEL, messages: [{ role: 'user', content }] });
const auth = async () => ({ authorization: `Bearer ${await s.newKey()}`, 'x-app-id': 'load-test', 'x-user-id': 'load-user' });
let n = 0;
const PROMPT = 'Summarise our quarterly planning notes into five bullet points for the leadership team, keeping the tone neutral and the figures as they are.';

console.log(`Load test: ${SECONDS}s per scenario, ${CONCURRENCY} at once, gateway ${GATEWAY}, ${os.cpus().length} CPUs (${os.cpus()[0]?.model ?? 'unknown'})\n`);
const results = [];
results.push(await run('baseline', async () => { const r = await call(MOCK, 'POST', '/v1/chat/completions', { body: chatBody(`${PROMPT} ${n++}`) }); return { status: r.status, ok: r.status === 200 }; }));
const h1 = await auth(); results.push(await run('chat', async () => { const r = await call(GATEWAY, 'POST', '/v1/chat/completions', { headers: h1, body: chatBody(`${PROMPT} ${n++}`) }); return { status: r.status, ok: r.status === 200 }; }));
const h2 = await auth(); results.push(await run('chat-pii', async () => { const r = await call(GATEWAY, 'POST', '/v1/chat/completions', { headers: h2, body: chatBody(`Email jane.doe@acme.example and call 415-555-0134 about ticket ${n++}. ${PROMPT}`) }); return { status: r.status, ok: r.status === 200 }; }));
const h3 = await auth(); results.push(await run('stopped', async () => { const r = await call(GATEWAY, 'POST', '/v1/chat/completions', { headers: h3, body: chatBody(`Notes on project-nightjar ${n++}`) }); return { status: r.status, ok: r.status === 403 }; }));
const mcpKey = await s.newKey();
results.push(await run('mcp', async () => {
  const r = await call(GATEWAY, 'POST', `/mcp/${s.tenantId}/${s.serverId}`, { headers: { authorization: `Bearer ${mcpKey}` }, body: { jsonrpc: '2.0', id: n++, method: 'tools/call', params: { name: 'getPerson', arguments: { id: `p${n}` } } } });
  return { status: r.status, ok: r.status === 200 && r.body?.result && !r.body.result.isError };
}));

const base = results[0];
console.log('\nTime added by Probaline over calling the model directly (p50 / p95):');
for (const r of results.slice(1, 3)) console.log(`  ${r.name.padEnd(9)} +${(r.p50 - base.p50).toFixed(1)} ms / +${(r.p95 - base.p95).toFixed(1)} ms`);

await call(GATEWAY, 'DELETE', `/v1/mcp/servers/${s.serverId}`, { headers: s.admin });
for (const id of s.keys) await call(GATEWAY, 'DELETE', `/v1/api-keys/${id}`, { headers: s.admin });
s.api.close(); agent.destroy();
const out = arg('json');
if (out) fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), seconds: SECONDS, concurrency: CONCURRENCY, cpus: os.cpus().length, cpu: os.cpus()[0]?.model, results }, null, 2));
