#!/usr/bin/env node
// Writes made-up access logs (AWS ALB and nginx) for the APIs in a Probaline API list, for demos and tests:
// most calls come from the gateway's address, a few go direct, fewer each week. Nothing here is real data.
// Usage: node collector/scripts/sample-api-logs.mjs <probaline-apis.json> <out-dir> [days=21]
import fs from 'node:fs';
import path from 'node:path';

const [listFile, out, daysArg] = process.argv.slice(2);
if (!listFile || !out) { console.error('usage: sample-api-logs.mjs <probaline-apis.json> <out-dir> [days]'); process.exit(1); }
const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
const days = Number(daysArg || 21);
const gateway = list.gateway?.egressIps?.[0] ?? '203.0.113.10';
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

// Callers that skip Probaline, and how many calls a day they make at first.
const direct = [
  { ip: '198.51.100.23', ua: 'python-requests/2.32.3', perDay: 30 },
  { ip: '198.51.100.71', ua: 'Claude-User (claude-code/1.0; +https://www.anthropic.com)', perDay: 12 },
  { ip: '10.20.4.17', ua: 'node-fetch/1.0', perDay: 6 },
];

fs.mkdirSync(out, { recursive: true });
const end = new Date();
for (let d = days - 1; d >= 0; d--) {
  const day = new Date(end.getTime() - d * 86_400_000);
  const progress = 1 - d / days; // direct calls fall as APIs get locked
  const alb = []; const nginx = [];
  for (const api of list.apis) {
    const base = api.basePath === '/' ? '' : api.basePath;
    const at = () => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 8 + Math.floor(rand() * 10), Math.floor(rand() * 60)));
    const line = (ip, ua) => {
      const t = at();
      if (api.connector) {
        const p = t.toUTCString().split(' ');
        nginx.push(`${api.host} ${ip} - - [${p[1]}/${p[2]}/${p[3]}:${p[4]} +0000] "GET ${base}/records/${Math.floor(rand() * 900)} HTTP/1.1" 200 512 "-" "${ua}"`);
      } else {
        alb.push(`https ${t.toISOString()} app/api-alb/50dc6c495c0c9188 ${ip}:${40000 + Math.floor(rand() * 20000)} 10.0.1.5:8080 0.001 0.020 0.000 200 200 34 366 "GET https://${api.host}:443${base}/records/${Math.floor(rand() * 900)} HTTP/1.1" "${ua}" ECDHE-RSA-AES128-GCM-SHA256 TLSv1.2 - "Root=1-0" "${api.host}" "-" 0 ${t.toISOString()} "forward" "-" "-" "10.0.1.5:8080" "200" "-" "-"`);
      }
    };
    for (let i = 0; i < 80 + Math.floor(rand() * 40); i++) line(gateway, 'Probaline-MCP/1.0');
    for (const c of direct) for (let i = 0; i < Math.round(c.perDay * (1 - progress * 0.9)); i++) line(c.ip, c.ua);
  }
  const stamp = day.toISOString().slice(0, 10).replace(/-/g, '');
  if (alb.length) fs.writeFileSync(path.join(out, `alb_${stamp}.log`), alb.join('\n') + '\n');
  if (nginx.length) fs.writeFileSync(path.join(out, `nginx_${stamp}.log`), nginx.join('\n') + '\n');
}
console.log(`Wrote ${days} days of access logs for ${list.apis.length} APIs to ${out}`);
