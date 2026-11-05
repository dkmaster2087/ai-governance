import dgram from 'dgram';
import net from 'net';
import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import { gunzipSync } from 'zlib';
import { Aggregator } from '../core/sightings';
import { buildReport, isoDay } from '../core/run';
import { FileStore, loadPseudonymizer, saveNames, saveSightings } from '../core/store';
import { LineReader, parseOnpremLine } from './parsers';

/**
 * The on-premises collector: one process that receives syslog (UDP and TCP) from firewalls and proxies,
 * follows DNS and proxy log files in a folder, keeps only AI matches as daily counts, and rebuilds the
 * report every day. Everything is written under DATA_DIR; nothing is sent anywhere.
 */

export interface OnpremOptions {
  dataDir: string;
  udpPort?: number; // 0 picks a free port (tests); undefined turns UDP off
  tcpPort?: number;
  watchDir?: string;
  flushSeconds?: number;
  pollSeconds?: number;
  reportAt?: string; // HH:MM UTC
  reportDays?: number;
  ignore?: string[];
  company?: string;
  log?: (msg: string) => void;
}

const MAX_MESSAGE = 65_536;
const MAX_TCP_CLIENTS = 200;

interface Offset { size: number; pos: number; done?: boolean; header?: LineReader['header'] }

export class OnpremCollector {
  private store: FileStore;
  private agg!: Aggregator;
  private udp?: dgram.Socket;
  private tcp?: net.Server;
  private timers: NodeJS.Timeout[] = [];
  private offsets: Record<string, Offset> = {};
  private flushing: Promise<void> = Promise.resolve();
  private lastReportDay = '';
  readonly stats = { received: 0, matched: 0, bySource: {} as Record<string, number>, lastMessageAt: '' as string, files: 0 };
  udpAddress?: number;
  tcpAddress?: number;

  constructor(private readonly o: OnpremOptions) {
    this.store = new FileStore(o.dataDir);
  }

  private log(msg: string) { (this.o.log ?? ((m) => console.log(`[probaline-collector] ${m}`)))(msg); }

  private async freshAggregator() {
    this.agg = new Aggregator({ pseudonyms: await loadPseudonymizer(this.store), ignore: this.o.ignore });
  }

  /** One log line, from syslog or a file. Files pass their own reader, which remembers a header row. */
  ingest(line: string, receivedAt = new Date(), reader?: LineReader) {
    this.stats.received++;
    const o = reader ? reader.read(line, receivedAt) : parseOnpremLine(line, receivedAt);
    if (!o) return;
    const before = this.agg.matched;
    this.agg.add(o);
    if (this.agg.matched > before) {
      this.stats.matched++;
      this.stats.bySource[o.source] = (this.stats.bySource[o.source] ?? 0) + 1;
      this.stats.lastMessageAt = receivedAt.toISOString();
    }
  }

  /** Save what has been counted so far and start a new batch. Calls queue behind each other. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      const current = this.agg;
      await this.freshAggregator();
      const byDay = current.byDay();
      if (byDay.size > 0) {
        await saveSightings(this.store, `onprem-${Date.now()}-${process.pid}`, byDay);
        await saveNames(this.store, current.pseudonyms);
      }
      await this.store.put('private/offsets.json', JSON.stringify(this.offsets));
      await this.store.put('status.json', JSON.stringify({ ...this.stats, updatedAt: new Date().toISOString(), udpPort: this.udpAddress, tcpPort: this.tcpAddress, watchDir: this.o.watchDir ?? null }, null, 2));
    }).catch((e) => this.log(`Saving failed: ${(e as Error).message}`));
    return this.flushing;
  }

  async report(now = new Date()) {
    await this.flush();
    const days = this.o.reportDays ?? 30;
    const to = isoDay(now);
    const from = isoDay(new Date(now.getTime() - (days - 1) * 86_400_000));
    const { findings, key } = await buildReport(this.store, { from, to, company: this.o.company, now });
    this.log(`Report built: ${key} (${findings.totals.services} AI services)`);
    return key;
  }

  // ── syslog ───────────────────────────────────────────────────────────────────

  private startUdp(port: number) {
    return new Promise<void>((resolve, reject) => {
      // A larger receive buffer rides out bursts; UDP syslog still drops when the sender outpaces it (TCP doesn't).
      const s = dgram.createSocket({ type: 'udp4', recvBufferSize: 8 * 1024 * 1024 });
      s.on('message', (buf) => {
        if (buf.length > MAX_MESSAGE) return;
        const now = new Date();
        for (const line of buf.toString('utf8').split(/\r?\n/)) if (line) this.ingest(line, now);
      });
      s.once('error', reject);
      s.bind(port, () => { this.udpAddress = s.address().port; this.udp = s; resolve(); });
    });
  }

  /** TCP syslog: octet-counted (RFC 6587 "123 <PRI>…") or newline-separated messages. */
  private startTcp(port: number) {
    return new Promise<void>((resolve, reject) => {
      const server = net.createServer((sock) => {
        let buf = Buffer.alloc(0);
        sock.setTimeout(600_000, () => sock.destroy());
        sock.on('data', (chunk: Buffer) => {
          buf = Buffer.concat([buf, chunk]);
          const now = new Date();
          for (;;) {
            // Octet counting: "<length> <PRI>…"; the length is in bytes.
            const head = /^(\d{1,5}) </.exec(buf.subarray(0, 8).toString('latin1'));
            if (head) {
              const len = Number(head[1]);
              const start = head[1].length + 1;
              if (len > MAX_MESSAGE) { sock.destroy(); return; }
              if (buf.length - start < len) break;
              this.ingest(buf.subarray(start, start + len).toString('utf8'), now);
              buf = buf.subarray(start + len);
              continue;
            }
            const nl = buf.indexOf(0x0a);
            if (nl < 0) break;
            const line = buf.subarray(0, nl).toString('utf8').replace(/\r$/, '');
            buf = buf.subarray(nl + 1);
            if (line) this.ingest(line, now);
          }
          if (buf.length > MAX_MESSAGE) { buf = Buffer.alloc(0); sock.destroy(); }
        });
        sock.on('error', () => sock.destroy());
      });
      server.maxConnections = MAX_TCP_CLIENTS;
      server.once('error', reject);
      server.listen(port, () => { this.tcpAddress = (server.address() as net.AddressInfo).port; this.tcp = server; resolve(); });
    });
  }

  // ── files ────────────────────────────────────────────────────────────────────

  private async listFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...(await this.listFiles(p)));
      else if (e.isFile()) out.push(p);
    }
    return out;
  }

  /**
   * Read what's new in each file since last time. Plain files are followed as they grow; if one shrinks it
   * was rotated, so it is read from the start. Compressed (.gz) files are read once.
   */
  async pollFiles() {
    if (!this.o.watchDir) return;
    for (const file of await this.listFiles(this.o.watchDir)) {
      const st = await fs.stat(file).catch(() => null);
      if (!st) continue;
      const key = `${file}|${st.ino}`;
      const off = this.offsets[key] ?? { size: 0, pos: 0 };
      if (file.endsWith('.gz')) {
        if (off.done) continue;
        const text = gunzipSync(await fs.readFile(file)).toString('utf8');
        const now = new Date();
        const reader = new LineReader();
        for (const line of text.split(/\r?\n/)) if (line) this.ingest(line, now, reader);
        this.offsets[key] = { size: st.size, pos: st.size, done: true };
        this.stats.files++;
        continue;
      }
      if (st.size < off.pos) off.pos = 0; // truncated or replaced
      if (st.size === off.pos) { this.offsets[key] = off; continue; }
      const now = new Date();
      const text = await new Promise<string>((resolve, reject) => {
        let s = '';
        createReadStream(file, { start: off.pos, end: st.size - 1, encoding: 'utf8' }).on('data', (c) => { s += c; }).on('end', () => resolve(s)).on('error', reject);
      });
      // Keep a trailing partial line for next time.
      const lastNl = text.lastIndexOf('\n');
      const complete = lastNl >= 0 ? text.slice(0, lastNl) : '';
      if (off.pos === 0) off.header = undefined;
      const reader = new LineReader(off.header);
      for (const line of complete.split(/\r?\n/)) if (line) this.ingest(line, now, reader);
      off.header = reader.header;
      off.pos += Buffer.byteLength(lastNl >= 0 ? text.slice(0, lastNl + 1) : '');
      off.size = st.size;
      if (!this.offsets[key]) this.stats.files++;
      this.offsets[key] = off;
    }
  }

  // ── lifecycle ────────────────────────────────────────────────────────────────

  async start() {
    await this.freshAggregator();
    this.offsets = JSON.parse((await this.store.get('private/offsets.json')) ?? '{}');
    if (this.o.udpPort !== undefined) await this.startUdp(this.o.udpPort);
    if (this.o.tcpPort !== undefined) await this.startTcp(this.o.tcpPort);
    const every = (sec: number, fn: () => unknown) => this.timers.push(setInterval(() => { Promise.resolve(fn()).catch((e) => this.log((e as Error).message)); }, sec * 1000));
    if (this.o.watchDir) { await this.pollFiles(); every(this.o.pollSeconds ?? 10, () => this.pollFiles()); }
    every(this.o.flushSeconds ?? 300, () => this.flush());
    every(60, () => {
      const now = new Date();
      const [h, m] = (this.o.reportAt ?? '05:30').split(':').map(Number);
      if (now.getUTCHours() === h && now.getUTCMinutes() === m && this.lastReportDay !== isoDay(now)) {
        this.lastReportDay = isoDay(now);
        return this.report(now);
      }
      return undefined;
    });
    this.log(`Listening: syslog UDP ${this.udpAddress ?? 'off'}, TCP ${this.tcpAddress ?? 'off'}; files: ${this.o.watchDir ?? 'off'}; results: ${this.o.dataDir}`);
  }

  async stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await new Promise<void>((r) => (this.udp ? this.udp.close(() => r()) : r()));
    await new Promise<void>((r) => (this.tcp ? this.tcp.close(() => r()) : r()));
    await this.flush();
  }
}

/** Container entry point, configured by environment variables. */
async function main() {
  const env = (k: string) => process.env[k];
  const port = (k: string, d: number) => (env(k) === 'off' ? undefined : Number(env(k) ?? d));
  const collector = new OnpremCollector({
    dataDir: env('DATA_DIR') ?? '/data',
    udpPort: port('SYSLOG_UDP_PORT', 5514),
    tcpPort: port('SYSLOG_TCP_PORT', 5514),
    watchDir: env('WATCH_DIR') || undefined,
    flushSeconds: Number(env('FLUSH_SECONDS') ?? 300),
    reportAt: env('REPORT_AT') ?? '05:30',
    reportDays: Number(env('REPORT_DAYS') ?? 30),
    ignore: (env('IGNORE') ?? '').split(',').filter(Boolean),
    company: env('COMPANY') || undefined,
  });
  await collector.start();
  const shutdown = async () => { await collector.stop(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
