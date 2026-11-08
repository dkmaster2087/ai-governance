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
    assert.equal((await call('PUT', '/v1/enforcement/paths/in_agents', { headers: as(A), body: { state: 'locked' } })).status, 409);

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
