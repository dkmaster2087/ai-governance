import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { allPages, collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { BackendResponse, EgressError } from './egress';
import { gatewayKeys } from './keys';

const logger = createLogger('gateway:mcp-connectors');

/**
 * Connectors reach APIs inside a company's network when Probaline runs in the cloud. A connector is a small
 * container the company runs; it opens outbound HTTPS connections to the gateway, collects calls waiting
 * for it, makes them inside the network and sends back the answers. No inbound firewall change.
 *
 * Calls wait in the shared storage layer, so any gateway instance can queue a call and any instance can hand
 * it to the connector. A queued call carries the API's credential, so it's stored encrypted, and deleted
 * once answered (or after five minutes).
 */

export interface Connector {
  tenantId: string;
  recordKey: string; // `connector#<id>`
  connectorId: string;
  name: string;
  /** Hosts this connector may call: `host`, `host:port` or `*.domain`. */
  allowedHosts: string[];
  tokenHash: string;
  tokenHint: string;
  createdAt: string;
  createdBy: string;
  lastSeenAt?: string;
  agentVersion?: string;
}

export interface JobRequest { method: string; url: string; headers: Record<string, string>; body?: string; timeoutMs: number; maxBytes: number }
export interface JobAnswer { status: number; contentType: string; body: string; truncated: boolean; ms: number; sessionId?: string }

interface Job {
  tenantId: string;
  recordKey: string; // `job#<connectorId>#<jobId>`
  jobId: string;
  connectorId: string;
  status: 'queued' | 'taken' | 'done' | 'cancelled';
  /** Encrypted JobRequest. */
  request: string;
  /** Encrypted JobAnswer, or an error. */
  answer?: string;
  error?: { code: string; message: string };
  createdAt: string;
  ttl: number;
}

const records = () => collection<Connector | Job>('mcpConnectors');
const ONLINE_MS = 60_000;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export const isOnline = (c: Connector) => !!c.lastSeenAt && Date.now() - Date.parse(c.lastSeenAt) < ONLINE_MS;

/** Does the connector allow this host? Exact host, host:port, or a `*.domain` wildcard. */
export function hostAllowed(c: Pick<Connector, 'allowedHosts'>, url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const withPort = `${host}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
  return c.allowedHosts.some((h) => {
    const x = h.toLowerCase();
    if (x.startsWith('*.')) return host.endsWith(x.slice(1)) && host.length > x.length - 1;
    return x === host || x === withPort;
  });
}

export const HOST_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

export class ConnectorService {
  constructor(private pollMs = 200) {}

  async list(tenantId: string): Promise<Connector[]> {
    return (await allPages((after) => records().query({ partition: tenantId, range: { beginsWith: 'connector#' }, after }))) as Connector[];
  }

  get = async (tenantId: string, connectorId: string) => (await records().get({ tenantId, recordKey: `connector#${connectorId}` })) as Connector | null;

  /** Create a connector. The token is returned once and only its hash is kept. */
  async create(tenantId: string, name: string, allowedHosts: string[], by: string): Promise<{ connector: Connector; token: string }> {
    const connectorId = `con_${randomBytes(6).toString('hex')}`;
    const secret = randomBytes(32).toString('base64url');
    const token = `pcn_${tenantId}.${connectorId}.${secret}`;
    const connector: Connector = {
      tenantId, recordKey: `connector#${connectorId}`, connectorId, name, allowedHosts,
      tokenHash: hash(token), tokenHint: `…${secret.slice(-4)}`, createdAt: new Date().toISOString(), createdBy: by,
    };
    await records().put(connector);
    return { connector, token };
  }

  async update(tenantId: string, connectorId: string, set: Partial<Pick<Connector, 'name' | 'allowedHosts'>>) {
    return (await records().update({ tenantId, recordKey: `connector#${connectorId}` }, { set, ifExists: true })) as Connector | null;
  }

  async remove(tenantId: string, connectorId: string) {
    await records().delete({ tenantId, recordKey: `connector#${connectorId}` });
  }

  /** The connector a token belongs to, or null. */
  async authenticate(token: string): Promise<Connector | null> {
    const m = /^pcn_([^.]+)\.(con_[a-f0-9]+)\.[A-Za-z0-9_-]+$/.exec(token);
    if (!m) return null;
    const c = await this.get(m[1], m[2]);
    if (!c) return null;
    const a = Buffer.from(hash(token)); const b = Buffer.from(c.tokenHash);
    return a.length === b.length && timingSafeEqual(a, b) ? c : null;
  }

  // ── Gateway side: make a call through a connector ──────────────────────────────────────────────

  async call(tenantId: string, connectorId: string, req: JobRequest): Promise<BackendResponse> {
    const c = await this.get(tenantId, connectorId);
    if (!c) throw new EgressError('The connector for this API was removed', 'CONNECTOR_MISSING');
    if (!hostAllowed(c, new URL(req.url))) throw new EgressError(`The connector ${c.name} isn't allowed to call ${new URL(req.url).host}`, 'CONNECTOR_HOST_NOT_ALLOWED');
    if (!isOnline(c)) throw new EgressError(`The connector ${c.name} is offline`, 'CONNECTOR_OFFLINE');

    const jobId = randomBytes(8).toString('hex');
    const key = { tenantId, recordKey: `job#${connectorId}#${jobId}` };
    const started = Date.now();
    await records().put({
      ...key, jobId, connectorId, status: 'queued', request: await gatewayKeys().encrypt(JSON.stringify(req)),
      createdAt: new Date().toISOString(), ttl: Math.floor(Date.now() / 1000) + 300,
    } satisfies Job);

    const pickupBy = started + 10_000;
    const answerBy = started + req.timeoutMs + 5_000;
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, this.pollMs));
        const job = (await records().get(key)) as Job | null;
        if (!job) throw new EgressError('The call through the connector was lost', 'CONNECTOR_ERROR');
        if (job.status === 'done') {
          if (job.error) throw new EgressError(job.error.message, job.error.code);
          const a = JSON.parse(await gatewayKeys().decrypt(job.answer!)) as JobAnswer;
          return { status: a.status, contentType: a.contentType, body: a.body, truncated: a.truncated, ms: Date.now() - started, ...(a.sessionId ? { sessionId: a.sessionId } : {}) };
        }
        if (job.status === 'queued' && Date.now() > pickupBy) {
          // Not picked up: take it back so the connector doesn't make the call later.
          if (await records().update(key, { set: { status: 'cancelled' }, where: { status: 'queued' } })) {
            throw new EgressError(`The connector ${c.name} didn't pick up the call`, 'CONNECTOR_OFFLINE');
          }
        }
        if (Date.now() > answerBy) throw new EgressError('The API didn\'t answer in time (through the connector)', 'BACKEND_TIMEOUT');
      }
    } finally {
      await records().delete(key).catch(() => undefined);
    }
  }

  // ── Connector side ─────────────────────────────────────────────────────────────────────────────

  /** Long poll: wait up to `waitMs` for calls, take up to `max` of them. */
  async take(c: Connector, waitMs: number, max = 5, agentVersion?: string): Promise<Array<{ id: string } & JobRequest>> {
    await records().update({ tenantId: c.tenantId, recordKey: c.recordKey }, { set: { lastSeenAt: new Date().toISOString(), ...(agentVersion ? { agentVersion: agentVersion.slice(0, 40) } : {}) }, ifExists: true });
    const until = Date.now() + waitMs;
    for (;;) {
      const page = await records().query({ partition: c.tenantId, range: { beginsWith: `job#${c.connectorId}#` }, limit: 50 });
      const out: Array<{ id: string } & JobRequest> = [];
      for (const j of page.items as Job[]) {
        if (j.status !== 'queued' || out.length >= max) continue;
        const taken = await records().update({ tenantId: c.tenantId, recordKey: j.recordKey }, { set: { status: 'taken' }, where: { status: 'queued' } });
        if (taken) out.push({ id: j.jobId, ...(JSON.parse(await gatewayKeys().decrypt(j.request)) as JobRequest) });
      }
      if (out.length || Date.now() >= until) return out;
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }

  /** The connector's answer to a call it took. */
  async answer(c: Connector, jobId: string, result: { answer?: JobAnswer; error?: { code: string; message: string } }): Promise<boolean> {
    const key = { tenantId: c.tenantId, recordKey: `job#${c.connectorId}#${jobId}` };
    const set: Record<string, unknown> = { status: 'done' };
    if (result.answer) set.answer = await gatewayKeys().encrypt(JSON.stringify(result.answer));
    else set.error = { code: String(result.error?.code ?? 'CONNECTOR_ERROR').slice(0, 40), message: String(result.error?.message ?? 'The connector couldn\'t make the call').slice(0, 300) };
    const done = await records().update(key, { set, where: { status: 'taken' } });
    if (!done) logger.info('Connector answered a call nobody waits for', { tenantId: c.tenantId, connectorId: c.connectorId, jobId });
    return !!done;
  }
}

let shared: ConnectorService | null = null;
export const connectorService = () => (shared ??= new ConnectorService());
export const setConnectorService = (s: ConnectorService | null) => { shared = s; };
