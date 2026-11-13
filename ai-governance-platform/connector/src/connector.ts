import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';

/**
 * The Probaline connector. It runs inside a company's network and lets the Probaline gateway in the cloud
 * reach the company's own APIs, without any inbound firewall change:
 *
 *   1. It asks the gateway for calls waiting for it (an outbound HTTPS request that waits up to 20 seconds).
 *   2. It makes each call inside the network: only to hosts allowed for it, never to cloud metadata
 *      addresses, never following redirects, with a time limit and a size cap.
 *   3. It sends the answer back, and asks again.
 *
 * The connector keeps nothing on disk and has no dependencies beyond Node.
 */

export const VERSION = '0.1.0';

export interface ConnectorConfig {
  /** The gateway's address, e.g. https://gateway.probaline.example. */
  gatewayUrl: string;
  /** The connector token shown once when the connector was created. */
  token: string;
  /** Optional: narrow the hosts this connector calls, on top of what the gateway allows. */
  localAllowedHosts?: string[];
  /** Calls made at the same time. */
  concurrency?: number;
  log?: (level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>) => void;
}

export interface Job { id: string; method: string; url: string; headers: Record<string, string>; body?: string; timeoutMs: number; maxBytes: number }
/** sessionId: an MCP server's `Mcp-Session-Id`, passed back so Probaline can keep the session. */
interface Answer { status: number; contentType: string; body: string; truncated: boolean; ms: number; sessionId?: string }

/** Addresses no connector should ever call: cloud instance metadata and its friends. */
const METADATA_HOSTS = new Set(['169.254.169.254', 'fd00:ec2::254', '169.254.170.2', 'metadata.google.internal', 'metadata.azure.com', '100.100.100.200']);

export function hostAllowed(allowedHosts: string[], url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const withPort = `${host}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
  return allowedHosts.some((h) => {
    const x = h.toLowerCase();
    if (x.startsWith('*.')) return host.endsWith(x.slice(1)) && host.length > x.length - 1;
    return x === host || x === withPort;
  });
}

function guardedLookup(hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, '', 0);
    const list = addresses as dns.LookupAddress[];
    if (list.some((a) => METADATA_HOSTS.has(a.address))) return cb(Object.assign(new Error(`${hostname} resolves to a cloud metadata address`), { code: 'EMETADATA' }), '', 0);
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

class CallError extends Error { constructor(readonly code: string, message: string) { super(message); } }

/** Make one call inside the network. */
export function makeCall(job: Job, allowedHosts: string[]): Promise<Answer> {
  const started = Date.now();
  let url: URL;
  try { url = new URL(job.url); } catch { return Promise.reject(new CallError('INVALID_URL', 'The call has an invalid address')); }
  if (!['http:', 'https:'].includes(url.protocol)) return Promise.reject(new CallError('INVALID_URL', 'Only http and https calls are made'));
  if (METADATA_HOSTS.has(url.hostname.toLowerCase().replace(/^\[|\]$/g, ''))) return Promise.reject(new CallError('HOST_NOT_ALLOWED', 'Cloud metadata addresses are never called'));
  if (!hostAllowed(allowedHosts, url)) return Promise.reject(new CallError('HOST_NOT_ALLOWED', `The connector isn't allowed to call ${url.host}`));
  const lib = url.protocol === 'https:' ? https : http;
  const headers = { ...job.headers, ...(job.body !== undefined ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(job.body)) } : {}) };
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: job.method, headers, lookup: guardedLookup as any, timeout: Math.min(job.timeoutMs, 60_000) }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        return reject(new CallError('BACKEND_REDIRECT', `The API answered with a redirect (${status}); redirects aren't followed`));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      res.on('data', (c: Buffer) => {
        if (truncated) return;
        if (size + c.length > job.maxBytes) { chunks.push(c.subarray(0, job.maxBytes - size)); size = job.maxBytes; truncated = true; res.destroy(); return; }
        chunks.push(c); size += c.length;
      });
      const session = res.headers['mcp-session-id'];
      const done = () => resolve({
        status, contentType: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks).toString('utf8'), truncated, ms: Date.now() - started,
        ...(typeof session === 'string' && session.length <= 200 ? { sessionId: session } : {}),
      });
      res.on('end', done);
      res.on('close', () => { if (truncated) done(); });
      res.on('error', (e) => (truncated ? done() : reject(new CallError('BACKEND_UNREACHABLE', e.message))));
    });
    req.on('timeout', () => req.destroy(new CallError('BACKEND_TIMEOUT', 'The API didn\'t answer in time')));
    req.on('error', (e: any) => reject(e instanceof CallError ? e : new CallError(e.code === 'EMETADATA' ? 'HOST_NOT_ALLOWED' : 'BACKEND_UNREACHABLE', `Couldn't reach the API: ${e.message}`)));
    if (job.body !== undefined) req.write(job.body);
    req.end();
  });
}

/** A JSON request to the gateway. */
function gatewayRequest(base: URL, path: string, token: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: any }> {
  const url = new URL(path, base);
  const lib = url.protocol === 'https:' ? https : http;
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = lib.request(url, {
      method: 'POST', timeout: timeoutMs,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(data)), 'user-agent': `Probaline-Connector/${VERSION}` },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : {} }); } catch { resolve({ status: res.statusCode ?? 0, json: {} }); }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('The gateway didn\'t answer in time')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

export class Connector {
  private stopped = false;
  private running = 0;
  private base: URL;

  constructor(private config: ConnectorConfig) {
    this.base = new URL(config.gatewayUrl.replace(/\/?$/, '/'));
  }

  private log(level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>) {
    (this.config.log ?? ((l, m, e) => console.log(JSON.stringify({ level: l, message: m, time: new Date().toISOString(), ...e }))))(level, message, extra);
  }

  stop() { this.stopped = true; }

  /** Ask for calls and make them, until stopped. */
  async run(): Promise<void> {
    let failures = 0;
    this.log('info', 'Connector started', { gateway: this.base.origin, version: VERSION });
    while (!this.stopped) {
      try {
        const r = await gatewayRequest(this.base, 'connector/v1/poll', this.config.token, { version: VERSION }, 40_000);
        if (r.status === 401) { this.log('error', 'The gateway doesn\'t accept this connector token. Create a new connector in the dashboard.'); return; }
        if (r.status !== 200) throw new Error(`The gateway answered ${r.status}`);
        failures = 0;
        const gatewayHosts: string[] = Array.isArray(r.json.allowedHosts) ? r.json.allowedHosts : [];
        for (const job of (r.json.jobs ?? []) as Job[]) this.handle(job, gatewayHosts);
        // Don't take more calls than we can make at once.
        while (this.running >= (this.config.concurrency ?? 8) && !this.stopped) await new Promise((res) => setTimeout(res, 50));
      } catch (err) {
        failures++;
        const wait = Math.min(30_000, 500 * 2 ** Math.min(failures, 6));
        this.log('warn', 'Couldn\'t reach the gateway; trying again', { error: (err as Error).message, retryInMs: wait });
        await new Promise((res) => setTimeout(res, wait));
      }
    }
    while (this.running > 0) await new Promise((res) => setTimeout(res, 50));
    this.log('info', 'Connector stopped');
  }

  /** Both lists must allow a host: the gateway's (set in the dashboard), and the local one if given. */
  allowed(gatewayHosts: string[]): string[] {
    const local = this.config.localAllowedHosts;
    if (!local?.length) return gatewayHosts;
    return gatewayHosts.filter((h) => local.some((l) => l.toLowerCase() === h.toLowerCase()));
  }

  private handle(job: Job, gatewayHosts: string[]) {
    this.running++;
    const host = (() => { try { return new URL(job.url).host; } catch { return '?'; } })();
    (async () => {
      let result: { answer?: Answer; error?: { code: string; message: string } };
      try {
        result = { answer: await makeCall(job, this.allowed(gatewayHosts)) };
        this.log('info', 'Call made', { id: job.id, method: job.method, host, status: result.answer!.status, ms: result.answer!.ms });
      } catch (err) {
        result = { error: { code: (err as CallError).code ?? 'CONNECTOR_ERROR', message: (err as Error).message } };
        this.log('warn', 'Call failed', { id: job.id, method: job.method, host, code: result.error!.code });
      }
      try {
        await gatewayRequest(this.base, 'connector/v1/answer', this.config.token, { id: job.id, ...result }, 15_000);
      } catch (err) {
        this.log('warn', 'Couldn\'t send an answer to the gateway', { id: job.id, error: (err as Error).message });
      }
    })().finally(() => { this.running--; });
  }
}
