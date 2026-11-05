import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { gzipSync } from 'zlib';
import { serviceForDomain } from '../core/catalog';
import { Aggregator, Pseudonymizer, mergeSightings } from '../core/sightings';
import { buildFindings } from '../core/findings';
import { renderReport } from '../core/report';
import { FileStore, loadNames } from '../core/store';
import { buildReport, decode, processInput } from '../core/run';
import { cloudTrailActor, detectSource, parseCloudTrail, parseNetworkFirewall, parseResolverDns } from '../aws/parsers';

const KEY = 'a'.repeat(64);
const dns = (name: string, ts = '2026-10-20T10:00:00Z', inst: string | null = 'i-0abc', ip = '10.0.3.12') =>
  JSON.stringify({ version: '1.100000', account_id: '111122223333', region: 'us-east-1', vpc_id: 'vpc-1', query_timestamp: ts, query_name: name, query_type: 'A', srcaddr: ip, srcids: inst ? { instance: inst } : {} });

describe('catalog', () => {
  it('recognizes AI services, their subdomains and cloud endpoints', () => {
    expect(serviceForDomain('api.openai.com.')?.id).toBe('openai-api');
    expect(serviceForDomain('CHATGPT.COM')?.id).toBe('chatgpt');
    expect(serviceForDomain('cdn.oaistatic.chatgpt.com')?.id).toBe('chatgpt');
    expect(serviceForDomain('bedrock-runtime.eu-west-1.amazonaws.com')?.id).toBe('aws-bedrock');
    expect(serviceForDomain('acme-prod.openai.azure.com')?.id).toBe('azure-openai');
    expect(serviceForDomain('us-central1-aiplatform.googleapis.com')?.id).toBe('vertex-ai');
  });

  it('does not match look-alikes or ordinary sites', () => {
    expect(serviceForDomain('notopenai.com')).toBeUndefined();
    expect(serviceForDomain('api.openai.com.evil.example')).toBeUndefined();
    expect(serviceForDomain('s3.us-east-1.amazonaws.com')).toBeUndefined();
    expect(serviceForDomain('example.com')).toBeUndefined();
  });
});

describe('aggregation and privacy', () => {
  it('drops non-AI lines, merges repeats per day, and replaces people with codes', () => {
    const p = new Pseudonymizer(KEY);
    const agg = new Aggregator({ pseudonyms: p });
    agg.add({ time: '2026-10-20T10:00:00Z', domain: 'api.openai.com', who: { type: 'host', value: 'i-1' }, source: 'aws_dns' });
    agg.add({ time: '2026-10-20T11:00:00Z', domain: 'api.openai.com', who: { type: 'host', value: 'i-1' }, source: 'aws_dns' });
    agg.add({ time: '2026-10-20T11:00:00Z', domain: 'www.amazon.com', who: { type: 'host', value: 'i-1' }, source: 'aws_dns' });
    agg.add({ time: '2026-10-20T11:00:00Z', service: 'aws-bedrock', who: { type: 'user', value: 'Jane.Doe@acme.com' }, source: 'aws_cloudtrail' });
    const rows = agg.sightings();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.service === 'openai-api')).toMatchObject({ count: 2, kind: 'api', who: 'host:i-1', day: '2026-10-20' });
    const person = rows.find((r) => r.service === 'aws-bedrock')!;
    expect(person.who).toMatch(/^user-[0-9a-f]{12}$/);
    expect(JSON.stringify(rows)).not.toContain('jane');
    expect(p.names.get(person.who)).toBe('jane.doe@acme.com');
    expect(new Pseudonymizer(KEY).code('jane.doe@acme.com')).toBe(person.who);
    expect(new Pseudonymizer('b'.repeat(64)).code('jane.doe@acme.com')).not.toBe(person.who);
    // The same account written three ways is one person.
    expect(new Set([p.code('ACME\\Jane.Doe'), p.code('jane.doe'), p.code('jane.doe@acme.com')]).size).toBe(1);
  });

  it('leaves out callers the customer lists, such as the Probaline gateway itself', () => {
    const agg = new Aggregator({ pseudonyms: new Pseudonymizer(KEY), ignore: ['role:probaline-gateway-task'] });
    agg.add({ time: '2026-10-20T10:00:00Z', service: 'aws-bedrock', who: { type: 'role', value: 'probaline-gateway-task' }, source: 'aws_cloudtrail' });
    expect(agg.sightings()).toEqual([]);
  });

  it('strips odd characters from names taken from logs', () => {
    const agg = new Aggregator({ pseudonyms: new Pseudonymizer(KEY) });
    agg.add({ time: '2026-10-20T10:00:00Z', domain: 'api.openai.com', who: { type: 'role', value: '<script>x</script>' }, source: 'aws_dns' });
    expect(agg.sightings()[0].who).toBe('role:scriptx/script');
  });
});

describe('AWS parsers', () => {
  it('reads Route 53 Resolver query logs', () => {
    const obs = [...parseResolverDns([dns('api.openai.com.'), dns('chatgpt.com.', undefined, null, '10.0.9.9'), 'not json', ''].join('\n'))];
    expect(obs).toHaveLength(2);
    expect(obs[0]).toMatchObject({ domain: 'api.openai.com.', who: { type: 'host', value: 'i-0abc' }, source: 'aws_dns' });
    expect(obs[1].who).toEqual({ type: 'ip', value: '10.0.9.9' });
  });

  it('reads Network Firewall TLS and HTTP events and skips flow-only ones', () => {
    const lines = [
      { firewall_name: 'fw', event_timestamp: '1792836000', event: { timestamp: '2026-10-25T10:00:00.123456+0000', event_type: 'tls', src_ip: '10.0.1.5', tls: { sni: 'api.anthropic.com' } } },
      { firewall_name: 'fw', event_timestamp: '', event: { timestamp: '2026-10-25T11:00:00.123456+0000', event_type: 'http', src_ip: '10.0.1.6', http: { hostname: 'api.mistral.ai' } } },
      { firewall_name: 'fw', event_timestamp: '1792836000', event: { event_type: 'netflow', src_ip: '10.0.1.5' } },
    ].map((l) => JSON.stringify(l)).join('\n');
    const obs = [...parseNetworkFirewall(lines)];
    expect(obs.map((o) => o.domain)).toEqual(['api.anthropic.com', 'api.mistral.ai']);
    expect(new Date(obs[1].time).toISOString()).toBe('2026-10-25T11:00:00.123Z');
  });

  it('reads CloudTrail model calls and ignores setup calls', () => {
    const doc = JSON.stringify({ Records: [
      { eventTime: '2026-10-21T09:00:00Z', eventSource: 'bedrock.amazonaws.com', eventName: 'InvokeModel', awsRegion: 'us-east-1', userIdentity: { type: 'AssumedRole', arn: 'arn:aws:sts::1:assumed-role/claims-bot/i-1', sessionContext: { sessionIssuer: { userName: 'claims-bot' } } } },
      { eventTime: '2026-10-21T09:05:00Z', eventSource: 'bedrock.amazonaws.com', eventName: 'ListFoundationModels', awsRegion: 'us-east-1', userIdentity: { type: 'IAMUser', userName: 'bob' } },
      { eventTime: '2026-10-21T09:06:00Z', eventSource: 'sagemaker.amazonaws.com', eventName: 'InvokeEndpoint', awsRegion: 'eu-west-1', userIdentity: { type: 'IAMUser', userName: 'bob' } },
    ] });
    const obs = [...parseCloudTrail(doc)];
    expect(obs.map((o) => [o.service, o.domain, o.who])).toEqual([
      ['aws-bedrock', 'bedrock-runtime.us-east-1.amazonaws.com', { type: 'role', value: 'claims-bot' }],
      ['aws-sagemaker', 'runtime.sagemaker.eu-west-1.amazonaws.com', { type: 'user', value: 'bob' }],
    ]);
  });

  it('treats IAM Identity Center sign-ins as people', () => {
    expect(cloudTrailActor({ type: 'AssumedRole', arn: 'arn:aws:sts::1:assumed-role/AWSReservedSSO_Dev_abc/jane@acme.com', sessionContext: { sessionIssuer: { userName: 'AWSReservedSSO_Dev_abc' } } }))
      .toEqual({ type: 'user', value: 'jane@acme.com' });
  });

  it('tells the logs apart by key or content', () => {
    expect(detectSource('AWSLogs/1/vpcdnsquerylogs/vpc-1/2026/10/20/x.log.gz', '')).toBe('aws_dns');
    expect(detectSource('AWSLogs/1/network-firewall/tls/2026/x.log.gz', '')).toBe('aws_firewall');
    expect(detectSource('AWSLogs/1/CloudTrail/us-east-1/2026/x.json.gz', '')).toBe('aws_cloudtrail');
    expect(detectSource('upload.json', '{"Records":[]}')).toBe('aws_cloudtrail');
    expect(detectSource('a.log', dns('x.com.'))).toBe('aws_dns');
    expect(detectSource('a.csv', 'a,b,c')).toBeNull();
  });

  it('reads gzip files', () => {
    expect(decode(gzipSync(Buffer.from('hello')))).toBe('hello');
    expect(decode(Buffer.from('plain'))).toBe('plain');
  });
});

describe('findings and recommendations', () => {
  const rows = mergeSightings([[
    { day: '2026-10-05', service: 'openai-api', domain: 'api.openai.com', kind: 'api', who: 'host:i-1', source: 'aws_dns', count: 10 },
    { day: '2026-10-25', service: 'openai-api', domain: 'api.openai.com', kind: 'api', who: 'host:i-1', source: 'aws_dns', count: 30 },
    { day: '2026-10-25', service: 'deepseek-api', domain: 'api.deepseek.com', kind: 'api', who: 'host:i-2', source: 'aws_dns', count: 5 },
    { day: '2026-10-25', service: 'aws-bedrock', domain: 'bedrock-runtime.us-east-1.amazonaws.com', kind: 'cloud_ai', who: 'role:claims-bot', source: 'aws_cloudtrail', count: 7 },
    { day: '2026-10-25', service: 'chatgpt', domain: 'chatgpt.com', kind: 'browser', who: 'ip:10.0.9.9', source: 'aws_dns', count: 3 },
    { day: '2026-10-25', service: 'claude', domain: 'claude.ai', kind: 'browser', who: 'ip:10.0.9.8', source: 'aws_dns', count: 2 },
  ]]);
  const f = buildFindings(rows, '2026-10-01', '2026-10-30', new Date('2026-10-30T12:00:00Z'));

  it('counts services, machines and direct callers', () => {
    expect(f.totals).toMatchObject({ services: 5, machines: 5, people: 0, count: 57, noTermsServices: 1 });
    expect(f.directApi[0]).toEqual({ who: 'host:i-1', services: ['OpenAI API'], count: 40 });
    expect(f.services.find((s) => s.id === 'openai-api')!.trend).toEqual({ first: 10, second: 30 });
    expect(f.coverage).toEqual({ callers: 2, share: 1 });
  });

  it('recommends routing direct callers first, then the cloud AI service, then blocking risky tools', () => {
    expect(f.recommendations.map((r) => r.priority)).toEqual(['high', 'high', 'medium', 'medium']);
    expect(f.recommendations[0].title).toBe('Route 2 servers and apps that call model APIs directly through Probaline');
    expect(f.recommendations[0].action).toContain('Routing all 2 puts all direct model-API traffic under policy.');
    expect(f.recommendations[1].title).toBe('Put Amazon Bedrock behind the gateway');
    expect(f.recommendations[2].items[0]).toMatch(/^DeepSeek API/);
  });

  it('suggests adding CloudTrail only when other AWS logs were read without it', () => {
    const noTrail = buildFindings(rows.filter((r) => r.source !== 'aws_cloudtrail'), '2026-10-01', '2026-10-30');
    expect(noTrail.recommendations.at(-1)!.title).toBe('Add CloudTrail to see direct use of Amazon Bedrock');
    const onprem = buildFindings(rows.map((r) => ({ ...r, source: 'squid' })), '2026-10-01', '2026-10-30');
    expect(onprem.recommendations.some((r) => r.title.includes('CloudTrail'))).toBe(false);
  });

  it('renders a report that escapes everything from the logs', () => {
    const evil = buildFindings([{ day: '2026-10-25', service: 'openai-api', domain: 'api.openai.com', kind: 'api', who: 'host:<img src=x onerror=alert(1)>', source: 'aws_dns', count: 1 }], '2026-10-01', '2026-10-30');
    const html = renderReport(evil);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
    expect(html).not.toMatch(/<script/i);
  });
});

describe('end to end on files', () => {
  it('collects twice without double counting, keeps names private, and builds the report', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'probaline-collector-'));
    const store = new FileStore(dir);
    const lines = [dns('api.openai.com.', '2026-10-28T10:00:00Z'), dns('api.openai.com.', '2026-10-28T11:00:00Z'), dns('www.google.com.', '2026-10-28T11:00:00Z')].join('\n');
    await processInput(store, 'file-1', parseResolverDns(lines));
    await processInput(store, 'file-1', parseResolverDns(lines));
    const trail = JSON.stringify({ Records: [{ eventTime: '2026-10-28T09:00:00Z', eventSource: 'bedrock.amazonaws.com', eventName: 'Converse', awsRegion: 'us-east-1', userIdentity: { type: 'IAMUser', userName: 'jane' } }] });
    await processInput(store, 'file-2', parseCloudTrail(trail));

    const { findings, html } = await buildReport(store, { from: '2026-10-01', to: '2026-10-30' });
    expect(findings.services.find((s) => s.id === 'openai-api')!.count).toBe(2);
    expect(html).not.toContain('jane');
    expect(Object.values(await loadNames(store))).toContain('jane');
    expect(await store.get('reports/latest.html')).toBe(html);

    const named = await buildReport(store, { from: '2026-10-01', to: '2026-10-30', revealNames: true });
    expect(named.key).toBe('private/report-with-names-2026-10-30.html');
    expect(named.html).toContain('jane');
    expect(await store.get('reports/latest.html')).toBe(html);
    await expect(store.put('../escape.txt', 'x')).rejects.toThrow();
  });
});
