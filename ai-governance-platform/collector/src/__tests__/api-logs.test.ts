import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import {
  classify, clientOf, detectApiLog, Inventory, matchApi, parseAlbLine, parseApiGatewayLine, parseEnvoyLine, parseInventory, parseNginxLine,
} from '../apis/access-logs';
import { FileStore } from '../core/store';
import { buildReport, processApiLog, processInventory } from '../core/run';

const INV: Inventory = parseInventory(JSON.stringify({
  schema: 'probaline.api_inventory/1',
  gateway: { issuer: 'https://gateway.acme.example', egressIps: ['203.0.113.4'] },
  apis: [
    { apiId: 'a1', name: 'People API', server: 'HR tools', host: 'hr.acme.example', basePath: '/api' },
    { apiId: 'a2', name: 'Payroll', server: 'HR tools', host: 'payroll.corp:8080', basePath: '/', connector: 'Datacenter' },
    { apiId: 'a3', name: 'Tickets', server: 'Support', host: 'support.acme.example', basePath: '/v2/tickets' },
  ],
}));

const alb = (ip: string, url: string, ua: string, time = '2026-11-09T10:00:00.123456Z') =>
  `https ${time} app/hr-alb/50dc6c495c0c9188 ${ip}:52114 10.0.1.5:8080 0.001 0.020 0.000 200 200 34 366 "GET ${url} HTTP/1.1" "${ua}" ECDHE-RSA-AES128-GCM-SHA256 TLSv1.2 arn:aws:elasticloadbalancing:eu-west-1:111122223333:targetgroup/hr/73e2d6bc24d8a067 "Root=1-58337262-36d228ad5d99923122bbe354" "hr.acme.example" "arn:aws:acm:eu-west-1:111122223333:certificate/x" 0 2026-11-09T10:00:00.100000Z "forward" "-" "-" "10.0.1.5:8080" "200" "-" "-"`;
const nginx = (ip: string, p: string, ua: string, host?: string) =>
  `${host ? `${host}:443 ` : ''}${ip} - - [09/Nov/2026:11:00:00 +0100] "GET ${p} HTTP/1.1" 200 512 "-" "${ua}"`;
const envoy = (xff: string, p: string, ua: string, authority: string) =>
  `[2026-11-09T10:00:00.000Z] "GET ${p} HTTP/1.1" 200 - 0 120 4 3 "${xff}" "${ua}" "4b0b2d6f-7f1e-4c5e" "${authority}" "10.0.2.9:8080"`;
const apigw = (ip: string, p: string, ua: string) =>
  JSON.stringify({ requestId: 'r1', requestTimeEpoch: Date.parse('2026-11-09T10:00:00Z'), sourceIp: ip, domainName: 'support.acme.example', httpMethod: 'GET', path: p, status: '200', userAgent: ua });

describe('access log formats', () => {
  it('reads ALB, API Gateway, nginx (with and without host) and Envoy lines', () => {
    expect(parseAlbLine(alb('198.51.100.7', 'https://hr.acme.example:443/api/employees/1?x=1', 'python-requests/2.32'))).toMatchObject({
      host: 'hr.acme.example', path: '/api/employees/1', clientIp: '198.51.100.7', userAgent: 'python-requests/2.32', source: 'alb_access',
    });
    expect(parseApiGatewayLine(apigw('198.51.100.8', '/v2/tickets/9', 'curl/8.4'))).toMatchObject({ host: 'support.acme.example', clientIp: '198.51.100.8', source: 'apigw_access' });
    const plain = parseNginxLine(nginx('10.0.0.9', '/salaries', 'Claude-User'))!;
    expect(plain).toMatchObject({ host: undefined, path: '/salaries', clientIp: '10.0.0.9', userAgent: 'Claude-User' });
    expect(plain.time.toISOString()).toBe('2026-11-09T10:00:00.000Z');
    expect(parseNginxLine(nginx('10.0.0.9', '/api/x', 'curl/8', 'hr.acme.example'))).toMatchObject({ host: 'hr.acme.example:443', clientIp: '10.0.0.9' });
    expect(parseEnvoyLine(envoy('198.51.100.9, 10.0.0.1', '/api/employees', 'node-fetch/1.0', 'hr.acme.example'))).toMatchObject({ host: 'hr.acme.example', clientIp: '198.51.100.9', source: 'envoy_access' });
    expect(parseAlbLine('not a log')).toBeNull();
    expect(parseNginxLine('{"query_name":"x"}')).toBeNull();
  });

  it('detects a file’s format from its lines', () => {
    expect(detectApiLog(['', alb('1.2.3.4', 'https://a/b', 'x')].join('\n'))).toBe(parseAlbLine);
    expect(detectApiLog(nginx('1.2.3.4', '/', 'x'))).toBe(parseNginxLine);
    expect(detectApiLog(envoy('1.2.3.4', '/', 'x', 'a'))).toBe(parseEnvoyLine);
    expect(detectApiLog(apigw('1.2.3.4', '/', 'x'))).toBe(parseApiGatewayLine);
    expect(detectApiLog('{"query_name":"api.openai.com"}\nfoo')).toBeNull();
  });
});

describe('matching calls to APIs behind Probaline', () => {
  it('matches host and the longest base path; without a host only an unambiguous path', () => {
    expect(matchApi(INV, 'hr.acme.example:443', '/api/employees')?.apiId).toBe('a1');
    expect(matchApi(INV, 'hr.acme.example', '/apix')).toBeUndefined();
    expect(matchApi(INV, 'payroll.corp:8080', '/anything')?.apiId).toBe('a2');
    expect(matchApi(INV, 'other.example', '/api/employees')).toBeUndefined();
    expect(matchApi(INV, undefined, '/v2/tickets/1')?.apiId).toBe('a3');
    // Without a host the longest base path wins: /api is People's, anything else falls to Payroll's "/".
    expect(matchApi(INV, undefined, '/api/x')?.apiId).toBe('a1');
    expect(matchApi(INV, undefined, '/other')?.apiId).toBe('a2');
    const twoHosts = { ...INV, apis: [...INV.apis, { apiId: 'a4', name: 'People EU', server: 'HR tools', host: 'hr.eu.acme.example', basePath: '/api' }] };
    expect(matchApi(twoHosts, undefined, '/api/x')).toBeUndefined();
    expect(matchApi(twoHosts, 'hr.eu.acme.example', '/api/x')?.apiId).toBe('a4');
  });

  it('names what made a call from its user agent', () => {
    expect(clientOf('Claude-User (claude-code/1.0)')).toBe('Claude');
    expect(clientOf('python-httpx/0.27')).toBe('Python script');
    expect(clientOf('Probaline-MCP/1.0')).toBe('Claims to be Probaline');
    expect(clientOf(undefined)).toBe('Unknown');
  });

  it('counts calls from the gateway’s and connector’s addresses as through Probaline', () => {
    const reqs = [
      parseAlbLine(alb('203.0.113.4', 'https://hr.acme.example/api/employees/1', 'Probaline-MCP/1.0'))!,
      parseAlbLine(alb('203.0.113.4', 'https://hr.acme.example/api/employees/2', 'Probaline-MCP/1.0'))!,
      parseAlbLine(alb('198.51.100.7', 'https://hr.acme.example/api/salaries', 'python-requests/2.32'))!,
      parseAlbLine(alb('198.51.100.66', 'https://hr.acme.example/api/x', 'Probaline-MCP/1.0'))!,
      parseEnvoyLine(envoy('10.0.5.4', '/run', 'Probaline-MCP/1.0', 'payroll.corp:8080'))!,
      parseAlbLine(alb('198.51.100.7', 'https://www.acme.example/home', 'Mozilla/5.0'))!, // not an API behind Probaline
    ];
    const { rows, seen, matched } = classify(reqs, INV, { gateway: ['ip:10.0.5.4'] });
    expect([seen, matched]).toEqual([6, 5]);
    const through = rows.filter((r) => r.via === 'probaline');
    expect(through.reduce((a, r) => a + r.count, 0)).toBe(3);
    expect(through.every((r) => r.client === 'Probaline')).toBe(true);
    expect(rows.find((r) => r.who === 'ip:198.51.100.66')).toMatchObject({ client: 'Claims to be Probaline' });
    expect(rows.find((r) => r.who === 'ip:198.51.100.7')).toMatchObject({ apiId: 'a1', client: 'Python script', count: 1 });
  });
});

describe('incoming verify end to end on files', () => {
  it('keeps the API list, reads access logs against it, and reports the share and who goes around', async () => {
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'probaline-api-'));
    const store = new FileStore(out);
    expect(await processApiLog(store, 'early.log', alb('1.2.3.4', 'https://hr.acme.example/api/x', 'x'))).toBeNull(); // no list yet
    expect(await processInventory(store, JSON.stringify({ ...INV, schema: 'probaline.api_inventory/1' }))).toBe(3);

    const albLog = [
      ...Array.from({ length: 8 }, (_, i) => alb('203.0.113.4', `https://hr.acme.example/api/employees/${i}`, 'Probaline-MCP/1.0')),
      alb('198.51.100.7', 'https://hr.acme.example/api/salaries', 'python-requests/2.32'),
      alb('198.51.100.7', 'https://hr.acme.example/api/salaries', 'python-requests/2.32'),
    ].join('\n');
    expect(await processApiLog(store, 'alb.log', albLog)).toMatchObject({ lines: 10, matched: 10, throughProbaline: 8 });
    await processApiLog(store, 'nginx.log', [nginx('10.9.9.9', '/v2/tickets/3', 'Claude-User'), nginx('203.0.113.4', '/v2/tickets/4', 'Probaline-MCP/1.0')].join('\n'));

    const { findings, html } = await buildReport(store, { from: '2026-11-01', to: '2026-11-10' });
    const p = findings.paths.find((x) => x.id === 'incoming_api')!;
    expect(p).toMatchObject({ share: 0.8, through: 8, direct: 2, gatewaySeen: true, measuredBy: 'AWS Application Load Balancer access logs', stillDirectCount: 2 });
    expect(p.sources.find((s) => s.source === 'nginx_access')!.share).toBe(0.5);
    expect(p.stillDirect[0]).toMatchObject({ who: 'ip:198.51.100.7', services: ['People API'], clients: ['Python script'], count: 2 });
    expect(findings.incomingApis!.map((a) => [a.name, a.direct])).toEqual([['People API', 2], ['Tickets', 1]]);
    expect(findings.recommendations[0].title).toMatch(/^Lock 2 APIs behind Probaline: 2 callers still go around it/);
    expect(findings.sources.map((s) => s.source)).toEqual(['alb_access', 'nginx_access']);
    expect(html).toContain('Calls to your APIs behind Probaline MCP servers');
    expect(html).toContain('Your APIs behind Probaline');
    expect(html).toContain('<th>Made by</th>');
  });
});
