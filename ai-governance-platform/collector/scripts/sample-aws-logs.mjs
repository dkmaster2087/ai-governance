#!/usr/bin/env node
// Writes three weeks of made-up AWS logs (Route 53 Resolver DNS, Network Firewall TLS, CloudTrail) in the
// folder layout and gzip format AWS uses, for demos and tests. Nothing here is real data.
// Usage: node collector/scripts/sample-aws-logs.mjs <out-dir> [days=21]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];
const days = Number(process.argv[3] || 21);
if (!out) { console.error('usage: sample-aws-logs.mjs <out-dir> [days]'); process.exit(1); }

const ACCOUNT = '111122223333';
const REGION = 'us-east-1';
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

// Servers calling model APIs directly, how often per day, and whether usage grows.
const servers = [
  { id: 'i-0a1b2c3d4e5f60001', domains: ['api.openai.com'], perDay: 120, growth: 1.6 },
  { id: 'i-0a1b2c3d4e5f60002', domains: ['api.openai.com', 'api.anthropic.com'], perDay: 60, growth: 1.1 },
  { id: 'i-0a1b2c3d4e5f60003', domains: ['api.anthropic.com'], perDay: 35, growth: 1 },
  { id: 'i-0a1b2c3d4e5f60004', domains: ['generativelanguage.googleapis.com'], perDay: 12, growth: 2.5 },
  { id: 'i-0a1b2c3d4e5f60005', domains: ['api.deepseek.com'], perDay: 6, growth: 1 },
  { id: 'i-0a1b2c3d4e5f60006', domains: ['api.mistral.ai'], perDay: 4, growth: 1 },
];
// Workspaces (VDI) whose users browse to chat tools; seen by IP through the firewall and DNS.
const desktops = Array.from({ length: 40 }, (_, i) => `10.20.${Math.floor(i / 20)}.${10 + (i % 20)}`);
const chatTools = [
  ['chatgpt.com', 0.55], ['claude.ai', 0.25], ['gemini.google.com', 0.2], ['chat.deepseek.com', 0.08],
  ['www.perplexity.ai', 0.12], ['grok.com', 0.04], ['otter.ai', 0.05], ['www.example.com', 0.9], ['github.com', 0.7],
];
const noise = ['s3.us-east-1.amazonaws.com', 'sts.amazonaws.com', 'registry.npmjs.org', 'api.github.com', 'www.google.com'];
const roles = [
  { identity: { type: 'AssumedRole', arn: `arn:aws:sts::${ACCOUNT}:assumed-role/claims-summarizer/i-0a1b2c3d4e5f60007`, sessionContext: { sessionIssuer: { userName: 'claims-summarizer', type: 'Role' } } }, perDay: 80 },
  { identity: { type: 'AssumedRole', arn: `arn:aws:sts::${ACCOUNT}:assumed-role/probaline-gateway-task/abc`, sessionContext: { sessionIssuer: { userName: 'probaline-gateway-task', type: 'Role' } } }, perDay: 200 },
  { identity: { type: 'AssumedRole', arn: `arn:aws:sts::${ACCOUNT}:assumed-role/AWSReservedSSO_DataScience_1a2b/priya.raman@acme.example`, sessionContext: { sessionIssuer: { userName: 'AWSReservedSSO_DataScience_1a2b', type: 'Role' } } }, perDay: 15 },
  { identity: { type: 'IAMUser', userName: 'legacy-batch-user', arn: `arn:aws:iam::${ACCOUNT}:user/legacy-batch-user` }, perDay: 5 },
];

const write = (key, text) => {
  const file = path.join(out, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(text));
};

const end = new Date();
end.setUTCHours(0, 0, 0, 0);
let files = 0;
for (let d = days - 1; d >= 0; d--) {
  const day = new Date(end.getTime() - d * 86400000);
  const progress = (days - 1 - d) / Math.max(days - 1, 1);
  const [y, m, dd] = day.toISOString().slice(0, 10).split('-');
  const at = () => new Date(day.getTime() + Math.floor(rand() * 86400000));

  const dnsLines = [];
  const dnsQuery = (name, src, instance) => dnsLines.push(JSON.stringify({
    version: '1.100000', account_id: ACCOUNT, region: REGION, vpc_id: 'vpc-0prod', query_timestamp: at().toISOString().replace(/\.\d+Z$/, 'Z'),
    query_name: `${name}.`, query_type: 'A', query_class: 'IN', rcode: 'NOERROR', answers: [], srcaddr: src, srcport: String(30000 + Math.floor(rand() * 30000)),
    transport: 'UDP', srcids: instance ? { instance } : {},
  }));
  for (const s of servers) {
    const n = Math.round(s.perDay * (1 + (s.growth - 1) * progress));
    for (let i = 0; i < n; i++) dnsQuery(pick(s.domains), `10.0.3.${10 + servers.indexOf(s)}`, s.id);
  }
  for (let i = 0; i < 400; i++) dnsQuery(pick(noise), '10.0.3.50', 'i-0a1b2c3d4e5f60099');

  const fwLines = [];
  for (const ip of desktops) {
    for (const [domain, p] of chatTools) {
      if (rand() < p) {
        const visits = 1 + Math.floor(rand() * 6);
        for (let i = 0; i < visits; i++) {
          const t = at();
          fwLines.push(JSON.stringify({ firewall_name: 'egress-fw', availability_zone: 'us-east-1a', event_timestamp: String(Math.floor(t.getTime() / 1000)),
            event: { timestamp: t.toISOString().replace('Z', '000+0000'), flow_id: Math.floor(rand() * 1e15), event_type: 'tls', src_ip: ip, src_port: 50000, dest_ip: '203.0.113.10', dest_port: 443, proto: 'TCP', tls: { sni: domain, version: 'TLS 1.3' } } }));
        }
      }
    }
  }

  const records = [];
  for (const r of roles) {
    for (let i = 0; i < r.perDay; i++) {
      records.push({ eventVersion: '1.09', userIdentity: r.identity, eventTime: at().toISOString().replace(/\.\d+Z$/, 'Z'), eventSource: 'bedrock.amazonaws.com',
        eventName: pick(['InvokeModel', 'Converse', 'ConverseStream']), awsRegion: REGION, sourceIPAddress: '10.0.4.4', requestParameters: { modelId: 'anthropic.claude-sonnet' }, eventType: 'AwsApiCall' });
    }
  }
  records.push({ eventTime: at().toISOString(), eventSource: 'bedrock.amazonaws.com', eventName: 'ListFoundationModels', awsRegion: REGION, userIdentity: roles[3].identity });

  const stamp = `${y}${m}${dd}T0000Z`;
  write(`AWSLogs/${ACCOUNT}/vpcdnsquerylogs/vpc-0prod/${y}/${m}/${dd}/vpc-0prod_${stamp}_sample.log.gz`, dnsLines.join('\n'));
  write(`AWSLogs/${ACCOUNT}/network-firewall/tls/${y}/${m}/${dd}/00/${ACCOUNT}_network-firewall_tls_${REGION}_egress-fw_${stamp}_sample.log.gz`, fwLines.join('\n'));
  write(`AWSLogs/${ACCOUNT}/CloudTrail/${REGION}/${y}/${m}/${dd}/${ACCOUNT}_CloudTrail_${REGION}_${stamp}_sample.json.gz`, JSON.stringify({ Records: records }));
  files += 3;
}
console.log(`Wrote ${files} sample log files for ${days} days to ${out}`);
