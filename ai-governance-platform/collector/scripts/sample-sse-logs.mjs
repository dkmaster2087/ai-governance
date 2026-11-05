#!/usr/bin/env node
// Made-up Zscaler and Netskope logs for demos and tests. Nothing here is real data.
//  - Zscaler NSS web logs in the JSON, LEEF and key=value feed formats (as syslog lines)
//  - Netskope Cloud Log Shipper page events (JSON lines) and a log-streaming transaction file (CSV, gzipped)
// Usage:
//   node collector/scripts/sample-sse-logs.mjs files <out-dir> [days=14]
//   node collector/scripts/sample-sse-logs.mjs send <host> <port> [days=14]   (UDP syslog, Zscaler and Netskope lines)
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import { gzipSync } from 'node:zlib';

const [mode, a, b, c] = process.argv.slice(2);
const days = Number((mode === 'send' ? c : b) || 14);
let seed = 11;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const people = ['jdoe', 'mokoro', 'priya', 'li.wei', 'sam', 'fatima', 'tom', 'nadia', 'ravi'].map((u) => `${u}@acme.example`);
const ai = ['chatgpt.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'chat.deepseek.com', 'www.perplexity.ai', 'copilot.microsoft.com', 'grok.com', 'otter.ai', 'notebooklm.google.com'];
const apis = ['api.openai.com', 'api.anthropic.com', 'api.mistral.ai', 'generativelanguage.googleapis.com'];
const other = ['www.bbc.co.uk', 'github.com', 'login.microsoftonline.com', 'slack.com', 'www.salesforce.com'];
const laptop = () => `192.168.${Math.floor(rand() * 40)}.${2 + Math.floor(rand() * 250)}`;
const host = () => (rand() < 0.55 ? (rand() < 0.8 ? pick(ai) : pick(apis)) : pick(other));
const zdate = (t) => `${DOW[t.getUTCDay()]} ${MON[t.getUTCMonth()]} ${String(t.getUTCDate()).padStart(2, ' ')} ${t.toISOString().slice(11, 19)} ${t.getUTCFullYear()}`;

const end = Date.now();
const out = { zscaler: [], netskopeEvents: [], netskopeCsv: ['date,time,time-taken,cs-bytes,sc-bytes,c-ip,cs-username,cs-method,cs-host,cs-uri,x-cs-app,x-cs-access-method'] };
for (let i = 0; i < days * 500; i++) {
  const t = new Date(end - rand() * days * 86400000);
  const h = host();
  const who = rand() < 0.9 ? pick(people) : 'Unknown';
  const ip = laptop();
  const size = Math.floor(rand() * 30000);
  const r = rand();
  if (r < 0.25) {
    const ev = { datetime: zdate(t), action: 'Allowed', login: who, cip: ip, hostname: h, url: `${h}/`, urlcategory: ai.includes(h) ? 'Generative AI' : 'Business', requestsize: String(size), vendor: 'Zscaler', product: 'NSS' };
    out.zscaler.push(`<134>1 ${t.toISOString()} nss01 - - - - ${JSON.stringify({ sourcetype: 'zscalernss-web', event: ev })}`);
  } else if (r < 0.4) {
    out.zscaler.push(`<13>${MON[t.getUTCMonth()]} ${String(t.getUTCDate()).padStart(2, ' ')} ${t.toISOString().slice(11, 19)} nss01 LEEF:1.0|Zscaler|NSSWeblog|5.7|Allowed|cat=${ai.includes(h) ? 'Generative AI' : 'Business'}\tdevTime=${Math.floor(t.getTime() / 1000)}\tsrc=${ip}\tusrName=${who}\turl=${h}/\thost=${h}\treqsize=${size}`);
  } else if (r < 0.5) {
    out.zscaler.push(`datetime="${zdate(t)}" action=Allowed login=${who} cip=${ip} url=https://${h}/ urlcategory="${ai.includes(h) ? 'Generative AI' : 'Business'}" appclass=General`);
  } else if (r < 0.75) {
    out.netskopeEvents.push(JSON.stringify({ _id: `e${i}`, timestamp: Math.floor(t.getTime() / 1000), type: 'page', access_method: 'Client', ur_normalized: who === 'Unknown' ? '' : who, user: who, srcip: ip, domain: h, url: `${h}/`, appcategory: ai.includes(h) ? 'Generative AI' : 'Business', client_bytes: size }));
  } else {
    const iso = t.toISOString();
    out.netskopeCsv.push([iso.slice(0, 10), iso.slice(11, 19), Math.floor(rand() * 900), size, Math.floor(rand() * 9000), ip, who === 'Unknown' ? '-' : who, rand() < 0.5 ? 'POST' : 'GET', h, '/', 'App', 'Client'].join(','));
  }
}

if (mode === 'files' && a) {
  fs.mkdirSync(path.join(a, 'zscaler'), { recursive: true });
  fs.mkdirSync(path.join(a, 'netskope'), { recursive: true });
  fs.writeFileSync(path.join(a, 'zscaler', 'nss-web.log'), out.zscaler.join('\n') + '\n');
  fs.writeFileSync(path.join(a, 'netskope', 'page-events.jsonl'), out.netskopeEvents.join('\n') + '\n');
  fs.writeFileSync(path.join(a, 'netskope', 'transactions.csv.gz'), gzipSync(out.netskopeCsv.join('\n') + '\n'));
  console.log(`Wrote ${out.zscaler.length} Zscaler and ${out.netskopeEvents.length + out.netskopeCsv.length - 1} Netskope lines to ${a}`);
} else if (mode === 'send' && a && b) {
  const sock = dgram.createSocket('udp4');
  let sent = 0;
  for (const l of [...out.zscaler, ...out.netskopeEvents]) {
    await new Promise((res) => sock.send(l, Number(b), a, res));
    if (++sent % 200 === 0) await new Promise((res) => setTimeout(res, 20));
  }
  sock.close();
  console.log(`Sent ${sent} syslog messages to ${a}:${b}`);
} else {
  console.error('usage: sample-sse-logs.mjs files <out-dir> [days] | send <host> <port> [days]');
  process.exit(1);
}
