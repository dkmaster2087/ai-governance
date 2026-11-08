import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { collection, MemoryStore, setRecords } from '@ai-governance/storage';
import { feedEntries, renderFeed, formatGuide } from '../enforcement/feed-formats';
import { FeedStore, newFeedId, newToken, parseToken, setFeedStore } from '../enforcement/feed-store';
import {
  awsLockPreview, checkPolicy, cloudFormationTemplate, feedPreview, generateAwsLock, LockInputError, SCP_MAX_CHARS, serviceControlPolicy, vpcEndpointPolicy,
} from '../enforcement/aws-lock';
import { createAdminActivityPlugin } from '../activity/admin-activity';
import { activityRoutes } from '../routes/activity.routes';
import { enforcementRoutes } from '../routes/enforcement.routes';
import { feedRoutes } from '../routes/feeds.routes';

const T = 'tenant_acme';
const GW = 'arn:aws:iam::111122223333:role/probaline-gateway-task';
const BREAK = 'arn:aws:iam::111122223333:role/ai-break-glass';
const META = { name: 'Firewalls', generatedAt: '2026-11-08T10:00:00.000Z' };

beforeEach(() => {
  setRecords(new MemoryStore());
  setFeedStore(new FeedStore());
});

// ── Feed contents ───────────────────────────────────────────────────────────────────────────────────────────

describe('AI-domain feed contents', () => {
  it('takes the chosen categories from the catalog, minus approved tools, without redundant subdomains', () => {
    const chat = feedEntries(['chat']).map((e) => e.domain);
    expect(chat).toEqual(expect.arrayContaining(['chatgpt.com', 'claude.ai', 'deepseek.com']));
    expect(chat).not.toContain('chat.deepseek.com'); // covered by *.deepseek.com
    expect(chat).not.toContain('api.openai.com');
    const both = feedEntries(['chat', 'model_api']).map((e) => e.domain);
    expect(both).toContain('api.openai.com');
    expect(both).not.toContain('api.deepseek.com');
    // Approving DeepSeek's chat app keeps its API blocked; approving under an earlier id works too.
    const approved = feedEntries(['chat', 'model_api'], ['deepseek', 'mistral']).map((e) => e.domain);
    expect(approved).toContain('api.deepseek.com');
    expect(approved).not.toContain('deepseek.com');
    expect(approved).not.toContain('chat.mistral.ai');
    expect([...both].sort()).toEqual(both);
  });

  it('blocks cloud endpoints by wildcard where the catalog allows it, never Bedrock', () => {
    const cloud = feedEntries(['cloud_ai']);
    expect(cloud.find((e) => e.domain === 'openai.azure.com')).toMatchObject({ exact: false, subdomains: true });
    expect(cloud.some((e) => e.domain.includes('amazonaws'))).toBe(false);
  });

  it('renders each format', () => {
    const entries = feedEntries(['model_api', 'cloud_ai']);
    const domains = renderFeed('domains', entries, META).body.split('\n');
    expect(domains).toContain('api.openai.com');
    expect(domains).toContain('*.api.openai.com');
    expect(domains).toContain('*.openai.azure.com');
    expect(domains).not.toContain('openai.azure.com');
    expect(domains.some((l) => l.startsWith('#'))).toBe(false);

    const rpz = renderFeed('rpz', entries, META).body;
    expect(rpz).toMatch(/^@ IN SOA localhost\. hostmaster\.localhost\. 2026110800 /m);
    expect(rpz).toContain('api.anthropic.com CNAME .');
    expect(rpz).toContain('*.api.anthropic.com CNAME .');

    const hosts = renderFeed('hosts', entries, META).body;
    expect(hosts).toContain('0.0.0.0 api.openai.com');
    expect(hosts).not.toContain('openai.azure.com\n');

    const zscaler = JSON.parse(renderFeed('zscaler', entries, META).body);
    expect(zscaler).toMatchObject({ superCategory: 'USER_DEFINED', configuredName: 'Probaline: Firewalls' });
    expect(zscaler.urls).toContain('.api.openai.com');

    const netskope = JSON.parse(renderFeed('netskope', entries, { ...META, name: 'Fire<walls>' }).body);
    expect(netskope.name).toBe('Probaline Firewalls');
    expect(netskope.data.urls).toContain('*.openai.azure.com');
  });

  it('keeps feed names from breaking out of comments', () => {
    const body = renderFeed('hosts', feedEntries(['chat']), { ...META, name: 'x\n0.0.0.0 google.com' }).body;
    expect(body).not.toMatch(/^0\.0\.0\.0 google\.com$/m);
  });

  it('names the gateway’s addresses in the rule for each format', () => {
    const guide = formatGuide(['203.0.113.4']);
    expect(guide.map((g) => g.id)).toEqual(['domains', 'zscaler', 'netskope', 'rpz', 'hosts']);
    expect(guide[0].rule).toContain('203.0.113.4');
    expect(formatGuide([])[0].rule).toContain('the gateway’s outbound addresses');
  });
});

describe('feed tokens', () => {
  it('carry the feed id and a secret that is only kept as a hash', () => {
    const id = newFeedId();
    const t = newToken(id);
    expect(parseToken(t.token)).toMatchObject({ feedId: id });
    expect(t.tokenHash).not.toContain(t.token.split('.')[1]);
    expect(parseToken('fd123.short')).toBeNull();
    expect(parseToken('../../etc/passwd')).toBeNull();
  });
});

// ── AWS lock ────────────────────────────────────────────────────────────────────────────────────────────────

describe('AWS lock generator', () => {
  it('denies model calls to everyone but the gateway and the emergency role', () => {
    const scp = serviceControlPolicy({ gatewayRoleArn: GW, breakGlassRoleArn: BREAK });
    expect(scp.Statement).toHaveLength(1);
    expect(scp.Statement[0]).toMatchObject({ Effect: 'Deny', Resource: '*', Condition: { ArnNotLike: { 'aws:PrincipalArn': [GW, BREAK] } } });
    expect(scp.Statement[0].Action).toEqual(expect.arrayContaining(['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'sagemaker:InvokeEndpoint']));
    expect(serviceControlPolicy({ gatewayRoleArn: GW, sagemaker: false }).Statement[0].Action.some((a) => a.startsWith('sagemaker'))).toBe(false);
    expect(checkPolicy(scp, { gatewayRoleArn: GW })).toEqual([]);
    expect(JSON.stringify(scp).length).toBeLessThan(SCP_MAX_CHARS);
  });

  it('never lets a policy deny the gateway', () => {
    const scp = serviceControlPolicy({ gatewayRoleArn: GW });
    scp.Statement[0].Condition.ArnNotLike['aws:PrincipalArn'] = [BREAK];
    expect(checkPolicy(scp, { gatewayRoleArn: GW })).toContain('The gateway role would be denied.');
  });

  it('writes a matching endpoint policy and a CloudFormation template for the management account', () => {
    const vpce = vpcEndpointPolicy({ gatewayRoleArn: GW });
    expect(vpce.Statement[0]).toMatchObject({ Effect: 'Allow', Principal: { AWS: '*' }, Condition: { ArnLike: { 'aws:PrincipalArn': [GW] } } });
    const cfn = cloudFormationTemplate({ gatewayRoleArn: GW, targetIds: ['ou-ab12-cdef3456'] }) as any;
    expect(cfn.Resources.ProbalineModelLock).toMatchObject({ Type: 'AWS::Organizations::Policy', Properties: { Type: 'SERVICE_CONTROL_POLICY', TargetIds: { Ref: 'TargetIds' } } });
    expect(cfn.Parameters.TargetIds.Default).toBe('ou-ab12-cdef3456');
  });

  it('rejects input that isn’t a role ARN or an OU', () => {
    expect(() => generateAwsLock({ gatewayRoleArn: 'arn:aws:iam::111122223333:user/bob' })).toThrow(LockInputError);
    expect(() => generateAwsLock({ gatewayRoleArn: GW, breakGlassRoleArn: GW })).toThrow(/different role/);
    expect(() => generateAwsLock({ gatewayRoleArn: GW, targetIds: ['ou-x"}'] })).toThrow(/Not an OU/);
    expect(generateAwsLock({ gatewayRoleArn: 'arn:aws-us-gov:iam::111122223333:role/path/to/gw' }).problems).toEqual([]);
  });

  it('warns when there is no emergency role', () => {
    expect(generateAwsLock({ gatewayRoleArn: GW }).notes[0]).toMatch(/No emergency role/);
    expect(generateAwsLock({ gatewayRoleArn: GW, breakGlassRoleArn: BREAK }).notes[0]).not.toMatch(/No emergency role/);
  });
});

// ── Previews from a findings file ───────────────────────────────────────────────────────────────────────────

const FINDINGS = {
  to: '2026-11-07',
  services: [
    { id: 'chatgpt', name: 'ChatGPT', category: 'chat' as const, people: 12, machines: 0, count: 300 },
    { id: 'openai-api', name: 'OpenAI API', category: 'model_api' as const, people: 0, machines: 3, count: 900 },
    { id: 'aws-bedrock', name: 'Amazon Bedrock', category: 'cloud_ai' as const, people: 2, machines: 1, count: 50 },
    { id: 'cursor', name: 'Cursor', category: 'coding' as const, people: 4, machines: 0, count: 80 },
  ],
  paths: [
    { id: 'model_api', stillDirect: [{ who: 'host:app-1', services: ['OpenAI API'], count: 900 }] },
    { id: 'cloud_ai', stillDirect: [
      { who: 'role:claims-bot', services: ['Amazon Bedrock'], count: 40 },
      { who: 'role:ai-break-glass', services: ['Amazon Bedrock'], count: 2 },
      { who: 'ip:10.0.0.5', services: ['Amazon Bedrock'], count: 6 },
      { who: 'role:vertex-job', services: ['Vertex AI'], count: 9 },
    ] },
  ],
};

describe('previews', () => {
  it('lists who the AWS lock would refuse, except the emergency role', () => {
    const blocked = awsLockPreview(FINDINGS, { gatewayRoleArn: GW, breakGlassRoleArn: BREAK });
    expect(blocked).toEqual([
      { who: 'role:claims-bot', services: ['Amazon Bedrock'], count: 40, identityKnown: true },
      { who: 'ip:10.0.0.5', services: ['Amazon Bedrock'], count: 6, identityKnown: false },
    ]);
  });

  it('reads older findings files without paths', () => {
    expect(awsLockPreview({ cloudAi: [{ who: 'role:x', services: ['Amazon Bedrock'], count: 1 }] }, { gatewayRoleArn: GW })).toHaveLength(1);
  });

  it('lists what a feed would stop, minus approved tools', () => {
    const p = feedPreview(FINDINGS, ['chat', 'model_api', 'cloud_ai']);
    expect(p.services.map((s) => s.id)).toEqual(['openai-api', 'chatgpt']);
    expect(p.apps).toEqual([{ who: 'host:app-1', services: ['OpenAI API'], count: 900 }]);
    expect(feedPreview(FINDINGS, ['chat'], ['chatgpt'])).toEqual({ services: [], apps: [] });
  });
});

// ── API ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe('enforcement API and the public feed', () => {
  let app: FastifyInstance;
  let role: 'tenant_admin' | 'tenant_auditor';

  beforeEach(async () => {
    process.env.GATEWAY_EGRESS_IPS = '203.0.113.4, 203.0.113.5';
    process.env.FEED_RATE_LIMIT = '8';
    await collection('tenants').put({ tenantId: T, name: 'Acme', shadowAi: { mode: 'monitor', decisions: { claude: 'allowed' } } });
    role = 'tenant_admin';
    app = Fastify({ trustProxy: true });
    await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });
    app.decorateRequest('principal', null);
    app.addHook('onRequest', async (req) => {
      if (req.url.startsWith('/public/')) return;
      req.principal = { kind: 'user', homeTenantId: T, userId: 'u_admin', role };
      req.tenantId = T; req.userId = 'u_admin'; req.correlationId = 'c';
    });
    await app.register(createAdminActivityPlugin());
    await app.register(enforcementRoutes, { prefix: '/v1' });
    await app.register(activityRoutes, { prefix: '/v1' });
    await app.register(feedRoutes, { prefix: '/public' });
  });
  afterEach(async () => { await app.close(); delete process.env.GATEWAY_EGRESS_IPS; delete process.env.FEED_RATE_LIMIT; });

  it('creates a feed, serves it by token, logs the fetch, rotates and revokes it', async () => {
    const created = await app.inject({ method: 'POST', url: '/v1/enforcement/feeds', payload: { name: 'Palo Alto', categories: ['chat', 'model_api'] } });
    expect(created.statusCode).toBe(201);
    const { feedId, urls, feed } = created.json();
    expect(feed.domains).toBeGreaterThan(20);
    expect(JSON.stringify(feed)).not.toContain(urls.domains.split('/')[6].split('.')[1]);
    const path = new URL(urls.domains).pathname;

    const fetched = await app.inject({ method: 'GET', url: path, headers: { 'x-forwarded-for': '198.51.100.20', 'user-agent': 'PAN-OS' } });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toMatch(/^text\/plain/);
    expect(fetched.body).toContain('chatgpt.com');
    expect(fetched.body).not.toMatch(/^claude\.ai$/m); // allowed on the Shadow AI page

    const view = (await app.inject({ method: 'GET', url: '/v1/enforcement' })).json();
    expect(view.egressIps).toEqual(['203.0.113.4', '203.0.113.5']);
    expect(view.formats[0].rule).toContain('203.0.113.4, 203.0.113.5');
    expect(view.feeds[0]).toMatchObject({ feedId, fetchCount: 1, lastFetchedFrom: '198.51.100.20', lastFetchedFormat: 'domains', lastFetchedAgent: 'PAN-OS' });
    expect(view.feeds[0]).not.toHaveProperty('tokenHash');

    // Wrong format, wrong tenant, wrong secret: all the same 404.
    expect((await app.inject({ method: 'GET', url: path.replace('/domains', '/xml') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: path.replace(T, 'tenant_other') })).statusCode).toBe(404);
    const wrong = path.replace(/\.[A-Za-z0-9_-]+\/domains$/, `.${'A'.repeat(43)}/domains`);
    expect((await app.inject({ method: 'GET', url: wrong })).statusCode).toBe(404);

    const rotated = (await app.inject({ method: 'POST', url: `/v1/enforcement/feeds/${feedId}/rotate` })).json();
    expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: new URL(rotated.urls.rpz).pathname })).body).toContain('CNAME .');

    expect((await app.inject({ method: 'DELETE', url: `/v1/enforcement/feeds/${feedId}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: new URL(rotated.urls.rpz).pathname })).statusCode).toBe(404);

    const activity = (await app.inject({ method: 'GET', url: '/v1/activity?category=admin' })).json();
    expect(activity.items.map((i: any) => i.action).sort()).toEqual(['feed.created', 'feed.revoked', 'feed.token_rotated']);
    expect(activity.items.find((i: any) => i.action === 'feed.created').target).toEqual({ feedId });
  });

  it('limits fetches per feed', async () => {
    const { urls } = (await app.inject({ method: 'POST', url: '/v1/enforcement/feeds', payload: { name: 'DNS', categories: ['chat'] } })).json();
    const path = new URL(urls.hosts).pathname;
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await app.inject({ method: 'GET', url: path })).statusCode);
    expect(codes.slice(0, 8).every((c) => c === 200)).toBe(true);
    expect(codes[9]).toBe(429);
  });

  it('lets auditors look but not change, and checks feed input', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/enforcement/feeds', payload: { name: 'x', categories: [] } })).json().error).toMatch(/at least one/);
    expect((await app.inject({ method: 'POST', url: '/v1/enforcement/feeds', payload: { name: 'x', categories: ['nope'] } })).statusCode).toBe(400);
    role = 'tenant_auditor';
    expect((await app.inject({ method: 'GET', url: '/v1/enforcement' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/enforcement/feeds', payload: { name: 'x', categories: ['chat'] } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/v1/enforcement/aws/generate', payload: { gatewayRoleArn: GW } })).statusCode).toBe(403);
  });

  it('previews a feed against a findings file without recording activity', async () => {
    const res = (await app.inject({ method: 'POST', url: '/v1/enforcement/feeds/preview', payload: { categories: ['chat', 'model_api'], findings: FINDINGS } })).json();
    expect(res.findingsTo).toBe('2026-11-07');
    expect(res.wouldBeBlocked.services.map((s: any) => s.id)).toEqual(['openai-api', 'chatgpt']);
    expect((await app.inject({ method: 'GET', url: '/v1/activity?category=admin' })).json().items).toEqual([]);
  });

  it('saves AWS settings, generates the lock with a preview, and records it', async () => {
    expect((await app.inject({ method: 'PUT', url: '/v1/enforcement/aws', payload: { gatewayRoleArn: 'nope' } })).statusCode).toBe(400);
    const saved = await app.inject({ method: 'PUT', url: '/v1/enforcement/aws', payload: { gatewayRoleArn: GW, breakGlassRoleArn: BREAK, targetIds: ['ou-ab12-cdef3456'] } });
    expect(saved.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/enforcement' })).json().aws).toMatchObject({ gatewayRoleArn: GW, targetIds: ['ou-ab12-cdef3456'] });

    const gen = (await app.inject({ method: 'POST', url: '/v1/enforcement/aws/generate', payload: { gatewayRoleArn: GW, breakGlassRoleArn: BREAK, findings: FINDINGS } })).json();
    expect(gen.problems).toEqual([]);
    expect(gen.serviceControlPolicy.Statement[0].Effect).toBe('Deny');
    expect(gen.wouldBeBlocked.map((w: any) => w.who)).toEqual(['role:claims-bot', 'ip:10.0.0.5']);
    const actions = (await app.inject({ method: 'GET', url: '/v1/activity?category=admin' })).json().items.map((i: any) => i.action);
    expect(actions.sort()).toEqual(['aws_lock.generated', 'aws_lock.settings_saved']);
  });
});
