// End-to-end tests of lock and verify, week 2: an AI-domain feed fetched by token like a firewall would, its
// fetch logged, its address rotated and revoked; tools allowed on the Shadow AI page left out; and the AWS lock
// written with a preview from a collector findings file. Week 3: findings files stored per tenant, each path's
// state next to its measured share, and a warning when a path marked locked still has traffic going direct.
// Every change is in the tenant's admin activity.
//
// Needs the local stack: scripts/dev-local.sh start (or --postgres). Run with: npm run test:e2e
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3000';
const platform = { authorization: 'Bearer test-key', 'x-tenant-id': 'tenant_platform', 'x-dev-role': 'platform_admin' };
const as = (tenantId, role = 'tenant_admin') => ({ authorization: 'Bearer test-key', 'x-tenant-id': tenantId, 'x-dev-role': role, 'x-user-id': 'e2e-admin' });
const GW = 'arn:aws:iam::111122223333:role/probaline-gateway-task';
const BREAK = 'arn:aws:iam::111122223333:role/ai-break-glass';

async function call(method, url, { headers = {}, body } = {}) {
  const res = await fetch(url.startsWith('http') ? url : GATEWAY + url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

async function ensureTenant(name, adminEmail) {
  const list = await call('GET', '/v1/tenants', { headers: platform });
  const found = list.body.find((t) => t.name === name);
  if (found) return found.tenantId;
  const res = await call('POST', '/v1/tenants', { headers: platform, body: { name, adminEmail, plan: 'starter' } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.tenantId;
}

// The gateway answers feed URLs with its PUBLIC_GATEWAY_URL; tests call the gateway they were given.
const local = (url) => GATEWAY + new URL(url).pathname;

let A; let B;
const feeds = [];

before(async () => {
  const health = await fetch(`${GATEWAY}/health`).catch(() => null);
  assert.ok(health?.ok, `gateway not running at ${GATEWAY}; start it with scripts/dev-local.sh start`);
  A = await ensureTenant('E2E enforcement A', 'e2e-enf-a@example.com');
  B = await ensureTenant('E2E enforcement B', 'e2e-enf-b@example.com');
});

const uploaded = [];

after(async () => {
  for (const f of uploaded) await call('DELETE', `/v1/enforcement/findings/${f.findingsId}`, { headers: as(f.tenantId) });
  await call('PUT', '/v1/enforcement/paths/out_model_api', { headers: as(A), body: { state: 'open' } });
  for (const f of feeds) await call('DELETE', `/v1/enforcement/feeds/${f.feedId}`, { headers: as(f.tenantId) });
  await call('PUT', '/v1/shadow-ai/policy', { headers: as(A), body: { decisions: { claude: null } } });
});

describe('AI-domain feed', () => {
  test('a firewall fetches the feed by token; the fetch shows on the dashboard; approved tools are left out', async () => {
    const allow = await call('PUT', '/v1/shadow-ai/policy', { headers: as(A), body: { decisions: { claude: 'allowed' } } });
    assert.equal(allow.status, 200, JSON.stringify(allow.body));

    const created = await call('POST', '/v1/enforcement/feeds', { headers: as(A), body: { name: 'E2E firewalls', categories: ['chat', 'model_api'] } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    feeds.push({ tenantId: A, feedId: created.body.feedId });
    const { urls } = created.body;

    const list = await call('GET', local(urls.domains), { headers: { 'user-agent': 'PAN-OS/11.1' } });
    assert.equal(list.status, 200);
    assert.match(list.headers.get('content-type'), /^text\/plain/);
    const lines = list.body.trim().split('\n');
    assert.ok(lines.includes('chatgpt.com') && lines.includes('*.chatgpt.com') && lines.includes('api.openai.com'));
    assert.ok(!lines.includes('claude.ai'), 'Claude is allowed on the Shadow AI page');

    const zscaler = await call('GET', local(urls.zscaler));
    assert.equal(zscaler.body.superCategory, 'USER_DEFINED');
    assert.ok(zscaler.body.urls.includes('.chatgpt.com'));
    const rpz = await call('GET', local(urls.rpz));
    assert.match(rpz.body, /^chatgpt\.com CNAME \.$/m);

    const view = await call('GET', '/v1/enforcement', { headers: as(A) });
    const feed = view.body.feeds.find((f) => f.feedId === created.body.feedId);
    assert.equal(feed.fetchCount, 3);
    assert.equal(feed.lastFetchedFormat, 'rpz');
    assert.ok(feed.lastFetchedFrom, 'the fetching address is recorded');
    assert.equal(feed.tokenHash, undefined);
    assert.deepEqual(view.body.egressIps, ['203.0.113.10']);
  });

  test('another tenant’s path, a wrong token and an unknown format all get the same 404', async () => {
    const created = await call('POST', '/v1/enforcement/feeds', { headers: as(A), body: { name: 'E2E probe', categories: ['chat'] } });
    feeds.push({ tenantId: A, feedId: created.body.feedId });
    const path = new URL(created.body.urls.hosts).pathname;
    const attempts = [
      path.replace(`/feeds/${A}/`, `/feeds/${B}/`),
      path.replace(/\.[^/]+\/hosts$/, `.${'A'.repeat(43)}/hosts`),
      path.replace(/\/hosts$/, '/xml'),
    ];
    for (const p of attempts) {
      const res = await call('GET', GATEWAY + p);
      assert.equal(res.status, 404, p);
      assert.equal(res.body, 'Not found\n');
    }
    // B can't see or revoke A's feed through its own API either.
    assert.equal((await call('DELETE', `/v1/enforcement/feeds/${created.body.feedId}`, { headers: as(B) })).status, 404);
  });

  test('a new address stops the old one; revoking stops both', async () => {
    const created = await call('POST', '/v1/enforcement/feeds', { headers: as(A), body: { name: 'E2E rotate', categories: ['model_api'] } });
    const { feedId, urls } = created.body;
    assert.equal((await call('GET', local(urls.domains))).status, 200);
    const rotated = await call('POST', `/v1/enforcement/feeds/${feedId}/rotate`, { headers: as(A) });
    assert.equal(rotated.status, 200);
    assert.equal((await call('GET', local(urls.domains))).status, 404);
    assert.equal((await call('GET', local(rotated.body.urls.domains))).status, 200);
    assert.equal((await call('DELETE', `/v1/enforcement/feeds/${feedId}`, { headers: as(A) })).status, 204);
    assert.equal((await call('GET', local(rotated.body.urls.domains))).status, 404);

    const activity = await call('GET', '/v1/activity?category=admin', { headers: as(A) });
    const actions = activity.body.items.filter((i) => i.target?.feedId === feedId).map((i) => i.action).sort();
    assert.deepEqual(actions, ['feed.created', 'feed.revoked', 'feed.token_rotated']);
  });

  test('auditors can read but not create feeds', async () => {
    assert.equal((await call('GET', '/v1/enforcement', { headers: as(A, 'tenant_auditor') })).status, 200);
    assert.equal((await call('POST', '/v1/enforcement/feeds', { headers: as(A, 'tenant_auditor'), body: { name: 'x', categories: ['chat'] } })).status, 403);
  });
});

describe('AWS lock', () => {
  const findings = {
    to: '2026-11-07',
    services: [{ id: 'aws-bedrock', name: 'Amazon Bedrock', category: 'cloud_ai', people: 1, machines: 2, count: 52 }],
    paths: [{ id: 'cloud_ai', stillDirect: [
      { who: 'role:claims-bot', services: ['Amazon Bedrock'], count: 40 },
      { who: 'role:ai-break-glass', services: ['Amazon Bedrock'], count: 2 },
    ] }],
  };

  test('saves settings, writes the policies with who they would refuse, and records it', async () => {
    const saved = await call('PUT', '/v1/enforcement/aws', { headers: as(A), body: { gatewayRoleArn: GW, breakGlassRoleArn: BREAK, targetIds: ['ou-ab12-cdef3456'] } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual((await call('GET', '/v1/enforcement', { headers: as(A) })).body.aws.targetIds, ['ou-ab12-cdef3456']);
    assert.equal((await call('GET', '/v1/enforcement', { headers: as(B) })).body.aws.targetIds, undefined, 'settings are per tenant');

    const gen = await call('POST', '/v1/enforcement/aws/generate', { headers: as(A), body: { gatewayRoleArn: GW, breakGlassRoleArn: BREAK, findings } });
    assert.equal(gen.status, 200, JSON.stringify(gen.body));
    assert.deepEqual(gen.body.problems, []);
    const deny = gen.body.serviceControlPolicy.Statement[0];
    assert.equal(deny.Effect, 'Deny');
    assert.deepEqual(deny.Condition.ArnNotLike['aws:PrincipalArn'], [GW, BREAK]);
    assert.equal(gen.body.cloudFormation.Resources.ProbalineModelLock.Type, 'AWS::Organizations::Policy');
    assert.deepEqual(gen.body.wouldBeBlocked.map((w) => w.who), ['role:claims-bot']);

    const bad = await call('POST', '/v1/enforcement/aws/generate', { headers: as(A), body: { gatewayRoleArn: 'arn:aws:iam::1:user/x' } });
    assert.equal(bad.status, 400);

    const actions = (await call('GET', '/v1/activity?category=admin', { headers: as(A) })).body.items.map((i) => i.action);
    assert.ok(actions.includes('aws_lock.generated') && actions.includes('aws_lock.settings_saved'));
  });
});

describe('paths and findings files', () => {
  const today = new Date().toISOString().slice(0, 10);
  const file = (to, share, still) => ({
    from: '2026-10-01', to, catalogVersion: '2026-11-07', sources: [{ label: 'dropped on upload' }],
    services: [{ id: 'chatgpt', name: 'ChatGPT', vendor: 'OpenAI', category: 'chat', people: 4, machines: 0, count: 50 }],
    paths: [{ id: 'model_api', share, through: share * 100, direct: (1 - share) * 100, gatewaySeen: true, measuredBy: 'AWS Route 53 Resolver DNS query logs',
      stillDirectCount: still, stillDirect: Array.from({ length: still }, (_, i) => ({ who: `host:app-${i}`, services: ['OpenAI API'], count: 10, fix: 'Route it.' })) }],
  });

  test('uploaded findings show per path with a trend; a lock the logs contradict is flagged; tenants are separate', async () => {
    for (const [to, share, still] of [['2026-10-24', 0.4, 6], [today, 0.8, 2]]) {
      const up = await call('POST', '/v1/enforcement/findings', { headers: as(A), body: { fileName: `findings-${to}.json`, findings: file(to, share, still) } });
      assert.equal(up.status, 201, JSON.stringify(up.body));
      uploaded.push({ tenantId: A, findingsId: up.body.findingsId });
    }
    let view = (await call('GET', '/v1/enforcement', { headers: as(A) })).body;
    let row = view.paths.find((p) => p.id === 'out_model_api');
    assert.equal(row.measured.share, 0.8);
    assert.equal(row.measured.stillDirectCount, 2);
    assert.deepEqual(row.trend.map((t) => t.share), [0.4, 0.8]);
    assert.equal(view.findings[0].to, today);
    assert.equal((await call('GET', '/v1/enforcement', { headers: as(B) })).body.findings.length, 0);

    const locked = await call('PUT', '/v1/enforcement/paths/out_model_api', { headers: as(A), body: { state: 'locked' } });
    assert.equal(locked.status, 200);
    assert.match(locked.body.path.warning, /2 callers still go direct/);
    assert.equal((await call('PUT', '/v1/enforcement/paths/nope', { headers: as(A), body: { state: 'locked' } })).status, 404);

    // Previews use the latest stored findings when none are sent.
    const preview = await call('POST', '/v1/enforcement/feeds/preview', { headers: as(A), body: { categories: ['chat'] } });
    assert.equal(preview.body.findingsTo, today);
    assert.equal(preview.body.wouldBeBlocked.services[0].id, 'chatgpt');

    const actions = (await call('GET', '/v1/activity?category=admin', { headers: as(A) })).body.items.map((i) => i.action);
    assert.ok(actions.includes('findings.uploaded') && actions.includes('enforcement_path.state_changed'));

    assert.equal((await call('POST', '/v1/enforcement/findings', { headers: as(A), body: { findings: { not: 'findings' } } })).status, 400);
    assert.equal((await call('POST', '/v1/enforcement/findings', { headers: as(A, 'tenant_auditor'), body: { findings: file(today, 1, 0) } })).status, 403);
  });
});

describe('incoming lock: an API protected by the verifier', () => {
  const SPEC = JSON.stringify({
    openapi: '3.0.3', info: { title: 'People API', version: '1' },
    paths: { '/employees/{id}': { get: { operationId: 'getEmployee', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] } } },
  });
  let api; let apiUrl; let serverId; let keyId;
  const seen = [];

  before(async () => {
    const http = await import('node:http');
    // Built by `npm run build -w packages/verify-identity`; the same code the dashboard hands out.
    const { createVerifier, HEADER } = await import('../../packages/verify-identity/dist/index.js');
    api = http.createServer(async (req, res) => {
      const verifier = createVerifier({ issuer: GATEWAY.replace('127.0.0.1', 'localhost'), audience: apiUrl });
      try {
        const who = await verifier.verify(req.headers[HEADER]);
        seen.push({ ...who, token: req.headers[HEADER] });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'e1', name: 'Jane Doe', askedBy: who.sub }));
      } catch (err) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, code: err.code }));
      }
    });
    await new Promise((r) => api.listen(0, '127.0.0.1', r));
    apiUrl = `http://127.0.0.1:${api.address().port}`;
  });
  after(async () => {
    if (serverId) await call('DELETE', `/v1/mcp/servers/${serverId}`, { headers: as(A) });
    if (keyId) await call('DELETE', `/v1/api-keys/${keyId}`, { headers: as(A) });
    await new Promise((r) => api?.close(r));
  });

  test('a direct call is refused; the same call through Probaline arrives with who asked', async () => {
    const direct = await fetch(`${apiUrl}/employees/e1`);
    assert.equal(direct.status, 401);
    assert.equal((await direct.json()).code, 'missing');

    const made = await call('POST', '/v1/mcp/servers', { headers: as(A), body: { name: `E2E locked API ${Date.now()}` } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    serverId = made.body.serverId;
    const added = await call('POST', `/v1/mcp/servers/${serverId}/apis`, { headers: as(A), body: { name: 'People API', baseUrl: apiUrl, openapi: SPEC, auth: { type: 'none' } } });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    assert.equal((await call('POST', `/v1/mcp/servers/${serverId}/publish`, { headers: as(A), body: {} })).status, 200);
    const key = await call('POST', '/v1/api-keys', { headers: as(A), body: { name: 'e2e-locked-agent', scopes: ['mcp'] } });
    keyId = key.body.keyId;

    // The kit lists this API with the audience its verifier needs.
    const kit = await call('GET', '/v1/enforcement/apis', { headers: as(A) });
    assert.ok(kit.body.apis.some((a) => a.serverId === serverId && a.audience === apiUrl));

    const res = await call('POST', `/mcp/${A}/${serverId}`, { headers: { authorization: `Bearer ${key.body.key}` },
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'getEmployee', arguments: { id: 'e1' } } } });
    assert.equal(res.body.result.isError, false, JSON.stringify(res.body));
    assert.match(res.body.result.content[0].text, /askedBy/);
    const who = seen.at(-1);
    assert.equal(who.tool, 'getEmployee');
    assert.equal(who.server, serverId);
    assert.equal(who.tenant, A);
    assert.match(who.sub, /^key:/);

    // A token replayed against another API is refused.
    const other = (await import('../../packages/verify-identity/dist/index.js')).createVerifier({ issuer: GATEWAY.replace('127.0.0.1', 'localhost'), audience: 'https://payroll.acme.example' });
    await assert.rejects(() => other.verify(who.token), (e) => e.code === 'wrong_audience');
  });
});

describe('incoming verify: access logs show calls that skipped Probaline', () => {
  const SPEC = JSON.stringify({ openapi: '3.0.3', info: { title: 'Ledger', version: '1' }, paths: { '/entries': { get: { operationId: 'listEntries' } } } });
  let serverId; let findingsId;
  after(async () => {
    if (serverId) await call('DELETE', `/v1/mcp/servers/${serverId}`, { headers: as(A) });
    if (findingsId) await call('DELETE', `/v1/enforcement/findings/${findingsId}`, { headers: as(A) });
    await call('PUT', '/v1/enforcement/paths/in_agents', { headers: as(A), body: { state: 'open' } });
  });

  test('the API list goes to the collector; its findings show the share on the agents row', async () => {
    const { mkdtemp, writeFile, readFile } = await import('node:fs/promises');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const os = await import('node:os');
    const path = await import('node:path');

    const made = await call('POST', '/v1/mcp/servers', { headers: as(A), body: { name: `E2E ledger ${Date.now()}` } });
    serverId = made.body.serverId;
    assert.equal((await call('POST', `/v1/mcp/servers/${serverId}/apis`, { headers: as(A), body: { name: 'Ledger', baseUrl: 'https://ledger.acme.example/v1', openapi: SPEC, auth: { type: 'none' } } })).status, 201);

    // 1. The API list, as the dashboard downloads it.
    const exported = await fetch(`${GATEWAY}/v1/enforcement/apis/export`, { headers: as(A) });
    assert.match(exported.headers.get('content-disposition'), /attachment/);
    const list = await exported.json();
    const ledger = list.apis.find((a) => a.host === 'ledger.acme.example');
    assert.equal(ledger.basePath, '/v1');
    const gatewayIp = list.gateway.egressIps[0];
    assert.ok(gatewayIp, 'the gateway’s outbound address is in the list');

    // 2. Access logs: nine calls from the gateway, three direct.
    const dir = await mkdtemp(path.join(os.tmpdir(), 'probaline-e2e-api-'));
    const day = new Date().toISOString().slice(0, 10);
    const alb = (ip, ua) => `https ${day}T09:00:00.000000Z app/alb/1 ${ip}:5000 10.0.0.5:80 0.001 0.002 0.000 200 200 10 20 "GET https://ledger.acme.example:443/v1/entries HTTP/1.1" "${ua}" - - - "Root=1" "ledger.acme.example" "-" 0 ${day}T09:00:00.000000Z "forward" "-" "-" "10.0.0.5:80" "200" "-" "-"`;
    await writeFile(path.join(dir, 'apis.json'), JSON.stringify(list));
    await writeFile(path.join(dir, 'alb.log'), [...Array(9).fill(alb(gatewayIp, 'Probaline-MCP/1.0')), ...Array(3).fill(alb('198.51.100.40', 'python-requests/2.32'))].join('\n'));
    const cli = path.join(process.cwd(), 'collector/dist/cli.js');
    const out = path.join(dir, 'out');
    const run = promisify(execFile);
    const collected = await run('node', [cli, 'collect', '--out', out, path.join(dir, 'apis.json'), path.join(dir, 'alb.log')]);
    assert.match(collected.stdout, /12 calls to APIs behind Probaline, 9 through it/);
    await run('node', [cli, 'report', '--out', out, '--days', '7']);
    const findings = JSON.parse(await readFile(path.join(out, 'reports', `findings-${day}.json`), 'utf8'));

    // 3. Uploaded, the agents row shows the share; marked locked, it warns.
    const up = await call('POST', '/v1/enforcement/findings', { headers: as(A), body: { fileName: `findings-${day}.json`, findings } });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    findingsId = up.body.findingsId;
    await call('PUT', '/v1/enforcement/paths/in_agents', { headers: as(A), body: { state: 'locked' } });
    const row = (await call('GET', '/v1/enforcement', { headers: as(A) })).body.paths.find((p) => p.id === 'in_agents');
    assert.equal(row.measured.share, 0.75);
    assert.equal(row.measured.stillDirect[0].who, 'ip:198.51.100.40');
    assert.match(row.warning, /1 caller still goes direct/);
  });
});
