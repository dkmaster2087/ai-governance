import dgram from 'dgram';
import net from 'net';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { gzipSync } from 'zlib';
import { OnpremCollector } from '../onprem/server';
import { FileStore, loadSightings } from '../core/store';
import { mergeSightings } from '../core/sightings';

const day = '2026-10-30';
const fortinet = (host: string, ip = '10.2.0.8') => `<189>date=${day} time=10:20:00 devid="FG100F" logid="0316013056" type="utm" subtype="webfilter" srcip=${ip} hostname="${host}"`;
const squid = (host: string, ip = '10.4.0.7') => `1793356800.123 245 ${ip} TCP_TUNNEL/200 6234 CONNECT ${host}:443 - HIER_DIRECT/1.2.3.4 -`;

async function setup(watch = false) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-onprem-'));
  const logs = path.join(dir, 'logs');
  await fs.mkdir(logs);
  const c = new OnpremCollector({ dataDir: path.join(dir, 'data'), udpPort: 0, tcpPort: 0, watchDir: watch ? logs : undefined, pollSeconds: 3600, flushSeconds: 3600, log: () => {} });
  await c.start();
  const counts = async () => {
    await c.flush();
    const rows = mergeSightings(await loadSightings(new FileStore(path.join(dir, 'data')), '2026-01-01', '2027-12-31'));
    return Object.fromEntries(rows.map((r) => [`${r.domain}|${r.who}`, r.count]));
  };
  return { dir, logs, c, counts };
}

const sendUdp = (port: number, msg: string) => new Promise<void>((resolve, reject) => {
  const s = dgram.createSocket('udp4');
  s.send(msg, port, '127.0.0.1', (e) => { s.close(); if (e) reject(e); else resolve(); });
});
const sendTcp = (port: number, chunks: Buffer[]) => new Promise<void>((resolve, reject) => {
  const s = net.connect(port, '127.0.0.1', async () => {
    for (const ch of chunks) { s.write(ch); await new Promise((r) => setTimeout(r, 20)); }
    s.end();
  });
  s.on('close', () => resolve());
  s.on('error', reject);
});
const settle = () => new Promise((r) => setTimeout(r, 150));

describe('on-premises collector', () => {
  it('counts AI sightings from UDP syslog and ignores everything else', async () => {
    const { c, counts } = await setup();
    try {
      await sendUdp(c.udpAddress!, fortinet('claude.ai'));
      await sendUdp(c.udpAddress!, fortinet('claude.ai'));
      await sendUdp(c.udpAddress!, fortinet('www.bbc.co.uk'));
      await sendUdp(c.udpAddress!, '<13>Oct 30 10:00:00 host sshd[1]: Accepted publickey');
      await settle();
      expect(await counts()).toEqual({ 'claude.ai|ip:10.2.0.8': 2 });
      expect(c.stats).toMatchObject({ received: 4, matched: 2, bySource: { syslog_fortinet: 2 } });
    } finally { await c.stop(); }
  });

  it('reads TCP syslog framed by length or by newline, even split mid-character', async () => {
    const { c, counts } = await setup();
    try {
      const a = Buffer.from(fortinet('api.openai.com'));
      const framed = Buffer.concat([Buffer.from(`${a.length} `), a]);
      const unicode = Buffer.from(`${fortinet('gemini.google.com')} note="café ☕"\n`);
      const cut = unicode.indexOf(Buffer.from('☕')) + 1; // split inside the 3-byte character
      await sendTcp(c.tcpAddress!, [framed.subarray(0, 10), framed.subarray(10), unicode.subarray(0, cut), unicode.subarray(cut), Buffer.from(`${fortinet('chatgpt.com')}\n`)]);
      await settle();
      expect(await counts()).toEqual({ 'api.openai.com|ip:10.2.0.8': 1, 'gemini.google.com|ip:10.2.0.8': 1, 'chatgpt.com|ip:10.2.0.8': 1 });
    } finally { await c.stop(); }
  });

  it('follows log files as they grow, handles rotation, reads .gz once, and remembers where it was', async () => {
    const { dir, logs, c, counts } = await setup(true);
    const access = path.join(logs, 'access.log');
    try {
      await fs.writeFile(access, `${squid('api.anthropic.com')}\n${squid('api.anthropic.com').slice(0, 20)}`); // last line incomplete
      await c.pollFiles();
      expect(await counts()).toEqual({ 'api.anthropic.com|ip:10.4.0.7': 1 });

      await fs.appendFile(access, `${squid('api.anthropic.com').slice(20)}\n`); // the rest of that line
      await c.pollFiles();
      expect((await counts())['api.anthropic.com|ip:10.4.0.7']).toBe(2);

      await fs.writeFile(access, `${squid('chatgpt.com', '10.4.0.9')}\n`); // rotated: smaller than before
      await fs.writeFile(path.join(logs, 'old.log.gz'), gzipSync(`${squid('grok.com')}\n`));
      await c.pollFiles();
      await c.pollFiles();
      const after = await counts();
      expect(after['chatgpt.com|ip:10.4.0.9']).toBe(1);
      expect(after['grok.com|ip:10.4.0.7']).toBe(1);
    } finally { await c.stop(); }

    // A restart picks up from the saved positions instead of reading everything again.
    const again = new OnpremCollector({ dataDir: path.join(dir, 'data'), watchDir: logs, pollSeconds: 3600, flushSeconds: 3600, log: () => {} });
    await again.start();
    await again.stop();
    const rows = mergeSightings(await loadSightings(new FileStore(path.join(dir, 'data')), '2026-01-01', '2027-12-31'));
    expect(rows.find((r) => r.domain === 'grok.com')!.count).toBe(1);
    expect(rows.find((r) => r.domain === 'api.anthropic.com')!.count).toBe(2);
  });

  it('builds the report and a status file', async () => {
    const { dir, c } = await setup();
    try {
      await sendUdp(c.udpAddress!, fortinet('chat.deepseek.com'));
      await settle();
      const key = await c.report(new Date('2026-10-31T06:00:00Z'));
      const html = await fs.readFile(path.join(dir, 'data', key), 'utf8');
      expect(html).toContain('DeepSeek');
      const status = JSON.parse(await fs.readFile(path.join(dir, 'data', 'status.json'), 'utf8'));
      expect(status).toMatchObject({ matched: 1, udpPort: c.udpAddress });
    } finally { await c.stop(); }
  });
});
