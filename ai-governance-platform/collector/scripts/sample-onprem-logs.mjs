#!/usr/bin/env node
// Made-up on-premises logs for demos and tests: Squid access log, BIND query log and Windows DNS debug log
// files, plus Fortinet, Palo Alto and Check Point (CEF) syslog lines. Nothing here is real data.
// Usage:
//   node collector/scripts/sample-onprem-logs.mjs files <out-dir> [days=14]
//   node collector/scripts/sample-onprem-logs.mjs send <host> <port> [days=14]   (UDP syslog)
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';

const [mode, a, b, c] = process.argv.slice(2);
const days = Number((mode === 'send' ? c : b) || 14);
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const users = ['acme\\jdoe', 'acme\\mokoro', 'acme\\priya', 'acme\\li.wei', 'acme\\sam', 'acme\\fatima', 'acme\\tom'];
const ai = ['chatgpt.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'chat.deepseek.com', 'www.perplexity.ai', 'copilot.microsoft.com', 'grok.com', 'otter.ai', 'poe.com'];
const apis = ['api.openai.com', 'api.openai.com', 'api.anthropic.com', 'api.mistral.ai', 'api.groq.com', 'openrouter.ai'];
const other = ['www.bbc.co.uk', 'github.com', 'login.microsoftonline.com', 'slack.com', 'www.google.com'];
const desktop = () => `10.20.${Math.floor(rand() * 4)}.${10 + Math.floor(rand() * 200)}`;
const server = () => `10.10.5.${10 + Math.floor(rand() * 8)}`;

const end = Date.now();
const lines = { squid: [], bind: [], windns: [], syslog: [] };
for (let i = 0; i < days * 600; i++) {
  const t = new Date(end - rand() * days * 86400000);
  const iso = t.toISOString();
  const r = rand();
  if (r < 0.3) {
    const host = rand() < 0.6 ? pick(ai) : pick(other);
    lines.squid.push(`${(t.getTime() / 1000).toFixed(3)}    ${Math.floor(rand() * 900)} ${desktop()} TCP_TUNNEL/200 ${Math.floor(rand() * 9000)} CONNECT ${host}:443 ${rand() < 0.5 ? pick(users).split('\\')[1] : '-'} HIER_DIRECT/203.0.113.5 -`);
  } else if (r < 0.5) {
    const host = rand() < 0.7 ? pick(apis) : pick(other);
    const d = `${String(t.getUTCDate()).padStart(2, '0')}-${MON[t.getUTCMonth()]}-${t.getUTCFullYear()} ${iso.slice(11, 23)}`;
    lines.bind.push(`${d} queries: info: client @0x7f2a1c0 ${server()}#${40000 + Math.floor(rand() * 20000)} (${host}): query: ${host} IN A +E(0)K (10.10.0.2)`);
  } else if (r < 0.65) {
    const host = rand() < 0.5 ? pick(ai) : pick(other);
    const h = t.getUTCHours();
    const enc = host.split('.').map((p) => `(${p.length})${p}`).join('') + '(0)';
    lines.windns.push(`${t.getUTCMonth() + 1}/${t.getUTCDate()}/${t.getUTCFullYear()} ${h % 12 || 12}:${iso.slice(14, 19)} ${h < 12 ? 'AM' : 'PM'} 0E58 PACKET  000000D3C2A5B1C0 UDP Rcv ${desktop()}      d1f0   Q [0001   D   NOERROR] A      ${enc}`);
  } else if (r < 0.82) {
    const host = rand() < 0.6 ? pick(ai) : pick(other);
    lines.syslog.push(`<189>date=${iso.slice(0, 10)} time=${iso.slice(11, 19)} devname="FGT-HQ" devid="FG100F" logid="0316013056" type="utm" subtype="webfilter" srcip=${desktop()} user="${pick(users).split('\\')[1]}" hostname="${host}" sentbyte=${Math.floor(rand() * 20000)}`);
  } else if (r < 0.92) {
    const f = Array(40).fill('');
    Object.assign(f, { 0: '1', 1: iso.slice(0, 19).replace(/-/g, '/').replace('T', ' '), 2: '012801012345', 3: 'THREAT', 4: 'url', 7: desktop(), 12: pick(users), 31: `"${rand() < 0.6 ? pick(ai) : pick(other)}/"` });
    lines.syslog.push(`<14>1 ${iso} pa-fw01 - - - - ${f.join(',')}`);
  } else {
    lines.syslog.push(`<134>${MON[t.getUTCMonth()]} ${String(t.getUTCDate()).padStart(2, ' ')} ${iso.slice(11, 19)} cp-gw CEF:0|Check Point|URL Filtering|R81|Allow|https|1|rt=${t.getTime()} src=${desktop()} suser=${pick(users).split('\\')[1]}@acme.example dhost=${rand() < 0.6 ? pick(ai) : pick(other)}`);
  }
}

if (mode === 'files' && a) {
  fs.mkdirSync(path.join(a, 'squid'), { recursive: true });
  fs.mkdirSync(path.join(a, 'bind'), { recursive: true });
  fs.mkdirSync(path.join(a, 'windns'), { recursive: true });
  fs.writeFileSync(path.join(a, 'squid', 'access.log'), lines.squid.join('\n') + '\n');
  fs.writeFileSync(path.join(a, 'bind', 'query.log'), lines.bind.join('\n') + '\n');
  fs.writeFileSync(path.join(a, 'windns', 'dns.log'), lines.windns.join('\n') + '\n');
  fs.writeFileSync(path.join(a, 'syslog-capture.log'), lines.syslog.join('\n') + '\n');
  console.log(`Wrote ${lines.squid.length + lines.bind.length + lines.windns.length + lines.syslog.length} lines to ${a}`);
} else if (mode === 'send' && a && b) {
  const sock = dgram.createSocket('udp4');
  let sent = 0;
  for (const l of lines.syslog) {
    await new Promise((res) => sock.send(l, Number(b), a, res));
    if (++sent % 200 === 0) await new Promise((res) => setTimeout(res, 20));
  }
  sock.close();
  console.log(`Sent ${sent} syslog messages to ${a}:${b}`);
} else {
  console.error('usage: sample-onprem-logs.mjs files <out-dir> [days] | send <host> <port> [days]');
  process.exit(1);
}
