import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { Aggregator, IdentityMatcher, Pseudonymizer, Sighting } from '../core/sightings';
import { buildFindings } from '../core/findings';
import { renderReport } from '../core/report';
import { FileStore } from '../core/store';
import { buildReport, processInput } from '../core/run';
import { Observation } from '../core/sightings';

const KEY = 'a'.repeat(64);
const row = (o: Partial<Sighting>): Sighting => ({
  day: '2026-10-20', service: 'openai-api', domain: 'api.openai.com', kind: 'api', who: 'host:app-1', source: 'aws_dns', count: 1, ...o,
});

describe('gateway identities', () => {
  it('match by exact value, prefix, type and IPv4 range', () => {
    const m = new IdentityMatcher(['role:Probaline-Gateway-Task', 'host:gw-*', 'ip:203.0.113.0/28', 'ip:198.51.100.7', 'nonsense', '']);
    expect(m.matches('role', 'probaline-gateway-task')).toBe(true);
    expect(m.matches('role', 'probaline-gateway-task-2')).toBe(false);
    expect(m.matches('host', 'gw-eu-1')).toBe(true);
    expect(m.matches('host', 'app-gw-1')).toBe(false);
    expect(m.matches('ip', '203.0.113.15')).toBe(true);
    expect(m.matches('ip', '203.0.113.16')).toBe(false);
    expect(m.matches('ip', '198.51.100.7')).toBe(true);
    expect(m.matches('ip', 'not-an-ip')).toBe(false);
    expect(new IdentityMatcher(['role:*']).matches('role', 'anything')).toBe(true);
    expect(new IdentityMatcher([]).empty).toBe(true);
  });

  it('count the gateway as through Probaline instead of dropping it, and still drop ignored callers', () => {
    const agg = new Aggregator({ pseudonyms: new Pseudonymizer(KEY), gateway: ['role:probaline-gateway-task', 'ip:10.0.0.0/24'], ignore: ['role:backup'] });
    const at = '2026-10-20T10:00:00Z';
    agg.add({ time: at, service: 'aws-bedrock', who: { type: 'role', value: 'probaline-gateway-task' }, source: 'aws_cloudtrail' });
    agg.add({ time: at, service: 'aws-bedrock', who: { type: 'role', value: 'claims-bot' }, source: 'aws_cloudtrail' });
    agg.add({ time: at, domain: 'api.openai.com', who: { type: 'ip', value: '10.0.0.9' }, source: 'aws_dns' });
    agg.add({ time: at, service: 'aws-bedrock', who: { type: 'role', value: 'backup' }, source: 'aws_cloudtrail' });
    const rows = agg.sightings();
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.via === 'probaline').map((r) => r.who).sort()).toEqual(['ip:10.0.0.9', 'role:probaline-gateway-task']);
    expect(agg.throughProbaline).toBe(2);
  });
});

describe('share through Probaline', () => {
  const rows: Sighting[] = [
    // DNS: the gateway looked up OpenAI 60 times, two apps 30 and 10 times.
    row({ who: 'role:gw', via: 'probaline', count: 60 }),
    row({ who: 'host:app-1', count: 30 }),
    row({ who: 'host:app-2', count: 10, service: 'anthropic-api', domain: 'api.anthropic.com' }),
    // The firewall saw fewer connections, in its own units.
    row({ who: 'role:gw', via: 'probaline', count: 5, source: 'aws_firewall' }),
    row({ who: 'host:app-1', count: 5, source: 'aws_firewall' }),
    // A person in a browser: not a path the gateway carries.
    row({ who: 'user-abc123abc123', kind: 'browser', service: 'chatgpt', domain: 'chatgpt.com', count: 9 }),
    // Bedrock with no gateway in CloudTrail.
    row({ who: 'role:claims-bot', kind: 'cloud_ai', service: 'aws-bedrock', domain: '', source: 'aws_cloudtrail', count: 4 }),
  ];
  const f = buildFindings(rows, '2026-10-01', '2026-10-30', new Date('2026-10-31T00:00:00Z'));

  it('measures each path within one source, the one that saw most', () => {
    const api = f.paths.find((p) => p.id === 'model_api')!;
    expect(api).toMatchObject({ through: 60, direct: 40, share: 0.6, measuredBy: 'AWS Route 53 Resolver DNS query logs', gatewaySeen: true, stillDirectCount: 2 });
    expect(api.sources.find((s) => s.source === 'aws_firewall')!.share).toBe(0.5);
    expect(api.stillDirect[0]).toMatchObject({ who: 'host:app-1', count: 35, services: ['OpenAI API'] });
    expect(api.stillDirect[0].fix).toMatch(/base address/);
  });

  it('says when the gateway was not seen on a path', () => {
    const cloud = f.paths.find((p) => p.id === 'cloud_ai')!;
    expect(cloud).toMatchObject({ share: 0, gatewaySeen: false, stillDirectCount: 1 });
    expect(cloud.stillDirect[0].fix).toMatch(/gateway’s role/);
  });

  it('leaves gateway traffic out of every other section', () => {
    expect(f.directApi.map((c) => c.who)).toEqual(['host:app-1', 'host:app-2']);
    expect(f.totals.machines).toBe(3);
    expect(f.sources.find((s) => s.source === 'aws_dns')!.count).toBe(109);
    expect(f.recommendations[0].items.join(' ')).not.toContain('role:gw');
  });

  it('puts the share first in the report, with the fix for each caller', () => {
    const html = renderReport(f);
    expect(html.indexOf('Share through Probaline')).toBeLessThan(html.indexOf('Recommendations'));
    expect(html).toContain('<b class="">60%</b>');
    expect(html).toContain('60 of 100 lookups and calls');
    expect(html).toContain('No traffic from the Probaline gateway was seen on this path');
    expect(html).toContain('Change the app’s AI base address');
  });

  it('says so when there is nothing to measure', () => {
    const html = renderReport(buildFindings([rows[5]], '2026-10-01', '2026-10-30'));
    expect(html).toContain('No apps or cloud workloads calling AI were found');
  });
});

describe('share trend across reports', () => {
  it('shows earlier shares from findings files in the results folder', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'probaline-share-'));
    const store = new FileStore(dir);
    const gateway = ['role:gw'];
    const obs = (day: string, gw: number, app: number): Observation[] => [
      ...Array.from({ length: gw }, () => ({ time: `${day}T10:00:00Z`, domain: 'api.openai.com', who: { type: 'role' as const, value: 'gw' }, source: 'aws_dns' })),
      ...Array.from({ length: app }, () => ({ time: `${day}T10:00:00Z`, domain: 'api.openai.com', who: { type: 'host' as const, value: 'app-1' }, source: 'aws_dns' })),
    ];
    // Three weekly reports: 25%, then 50%, then 75% through Probaline.
    const weeks: Array<[string, number, number]> = [['2026-10-05', 1, 3], ['2026-10-12', 2, 2], ['2026-10-19', 3, 1]];
    for (const [d, gw, app] of weeks) {
      await processInput(store, `log-${d}`, obs(d, gw, app), [], gateway);
      const from = new Date(Date.parse(`${d}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
      await buildReport(store, { from, to: d });
    }
    const last = JSON.parse((await store.get('reports/findings-2026-10-19.json'))!);
    expect(last.paths[0].share).toBe(0.75);
    expect(last.history).toEqual([
      { to: '2026-10-05', shares: { model_api: 0.25 } },
      { to: '2026-10-12', shares: { model_api: 0.5 } },
    ]);
    const html = (await store.get('reports/latest.html'))!;
    expect(html).toContain('Earlier reports: 5 Oct 2026: 25% · 12 Oct 2026: 50%.');
  });
});
