import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';

/**
 * Calls from the gateway to a company's API. Only the registered base URL is ever called; redirects aren't
 * followed; private, loopback, link-local and cloud metadata addresses are refused on every connection (so
 * DNS can't be pointed somewhere internal after the check), unless the operator allows private backends for a
 * self-hosted gateway inside the company network. Responses are capped in size and time.
 */

export class EgressError extends Error {
  constructor(message: string, readonly code = 'BACKEND_UNREACHABLE') { super(message); }
}

const allowPrivate = () => process.env.MCP_ALLOW_PRIVATE_BACKENDS === 'true';
const allowHttp = () => process.env.MCP_ALLOW_HTTP_BACKENDS === 'true';

/** True for addresses an internet-facing gateway must never call. */
export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x.startsWith('::ffff:')) return isPrivateAddress(x.slice(7));
    return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('ff');
  }
  return true;
}

/** Check a base URL when an admin registers it. */
export function checkBaseUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new EgressError('The base URL isn\'t a valid URL', 'INVALID_BASE_URL'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && allowHttp())) throw new EgressError('The base URL must use https', 'INVALID_BASE_URL');
  if (u.username || u.password) throw new EgressError('Put credentials in the credential field, not the URL', 'INVALID_BASE_URL');
  if (u.search || u.hash) throw new EgressError('The base URL can\'t have a query or fragment', 'INVALID_BASE_URL');
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(u.hostname.replace(/^\[|\]$/g, '')) && !allowPrivate()) {
    throw new EgressError('Private addresses are only allowed for a self-hosted gateway', 'INVALID_BASE_URL');
  }
  return u;
}

/** DNS lookup that refuses private addresses (unless allowed), used for every connection. */
function guardedLookup(hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, '', 0);
    const list = addresses as dns.LookupAddress[];
    if (!allowPrivate() && list.some((a) => isPrivateAddress(a.address))) {
      return cb(Object.assign(new Error(`${hostname} resolves to a private address`), { code: 'EPRIVATE' }), '', 0);
    }
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

export interface BackendResponse { status: number; contentType: string; body: string; truncated: boolean; ms: number }

export function callBackend(o: {
  url: URL; method: string; headers: Record<string, string>; body?: string; timeoutMs?: number; maxBytes: number; contentType?: string;
}): Promise<BackendResponse> {
  const started = Date.now();
  const lib = o.url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(o.url, {
      method: o.method,
      headers: { ...o.headers, ...(o.body !== undefined ? { 'content-type': o.contentType ?? 'application/json', 'content-length': String(Buffer.byteLength(o.body)) } : {}) },
      lookup: guardedLookup as any,
      timeout: o.timeoutMs ?? 15_000,
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        return reject(new EgressError(`The API answered with a redirect (${status}); redirects aren't followed`, 'BACKEND_REDIRECT'));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      res.on('data', (c: Buffer) => {
        if (truncated) return;
        if (size + c.length > o.maxBytes) {
          chunks.push(c.subarray(0, o.maxBytes - size));
          size = o.maxBytes;
          truncated = true;
          res.destroy();
          return;
        }
        chunks.push(c);
        size += c.length;
      });
      const done = () => resolve({ status, contentType: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks).toString('utf8'), truncated, ms: Date.now() - started });
      res.on('end', done);
      res.on('close', () => { if (truncated) done(); });
      res.on('error', (e) => (truncated ? done() : reject(new EgressError(e.message))));
    });
    req.on('timeout', () => req.destroy(new EgressError('The API didn\'t answer in time', 'BACKEND_TIMEOUT')));
    req.on('error', (e: any) => reject(e instanceof EgressError ? e : new EgressError(e.code === 'EPRIVATE' ? e.message : `Couldn't reach the API: ${e.message}`, e.code === 'EPRIVATE' ? 'BACKEND_PRIVATE' : 'BACKEND_UNREACHABLE')));
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}
