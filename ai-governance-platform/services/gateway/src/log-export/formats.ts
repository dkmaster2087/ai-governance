import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import type { ExportRecord } from './records';

/** Where records go. Each speaks the destination's own intake format. */
export type DestinationKind = 'webhook' | 'splunk_hec' | 'otlp_http';
export const DESTINATION_KINDS: readonly DestinationKind[] = ['webhook', 'splunk_hec', 'otlp_http'];

/** Secrets for a destination, kept in the secret store as one JSON value. */
export interface DestinationSecrets {
  url: string;
  /** webhook: HMAC key for the signature header. */
  signingSecret?: string;
  /** splunk_hec: the HEC token. */
  token?: string;
  /** otlp_http: headers the collector needs (Authorization, DD-API-KEY, …). */
  headers?: Record<string, string>;
}

export interface DestinationOptions {
  kind: DestinationKind;
  /** splunk_hec: index (optional; the token's default otherwise). */
  splunkIndex?: string;
}

export interface OutgoingRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const USER_AGENT = 'Probaline-LogExport/1';

/**
 * Webhook signature: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. The receiver recomputes it with
 * the signing secret and refuses old timestamps (replays).
 */
export function signatureHeader(secret: string, body: string, unixSeconds: number): string {
  const mac = createHmac('sha256', secret).update(`${unixSeconds}.${body}`).digest('hex');
  return `t=${unixSeconds},v1=${mac}`;
}

/** Check a signature as a receiver would (used in tests and documented for customers). */
export function verifySignature(secret: string, body: string, header: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > toleranceSeconds || !parts.v1) return false;
  const expected = Buffer.from(signatureHeader(secret, body, t).split('v1=')[1], 'hex');
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Add the standard path when someone pastes only the host. */
function withPath(raw: string, path: string): string {
  const u = new URL(raw);
  if (u.pathname === '/' || u.pathname === '') u.pathname = path;
  return u.href;
}

function webhook(o: DestinationOptions, s: DestinationSecrets, records: ExportRecord[], batchId: string, now: Date): OutgoingRequest {
  const body = JSON.stringify({ schema: 'probaline.batch/1', batchId, sentAt: now.toISOString(), count: records.length, records });
  return {
    url: s.url,
    headers: {
      'user-agent': USER_AGENT,
      'x-probaline-batch-id': batchId,
      ...(s.signingSecret ? { 'x-probaline-signature': signatureHeader(s.signingSecret, body, Math.floor(now.getTime() / 1000)) } : {}),
    },
    body,
  };
}

/** Splunk HTTP Event Collector: one JSON event object after another, in one request. */
function splunk(o: DestinationOptions, s: DestinationSecrets, records: ExportRecord[], batchId: string): OutgoingRequest {
  const body = records.map((r) => JSON.stringify({
    time: Date.parse(r.time) / 1000,
    host: 'probaline',
    source: 'probaline',
    sourcetype: `probaline:${r.type}`,
    ...(o.splunkIndex ? { index: o.splunkIndex } : {}),
    event: r,
  })).join('\n');
  return {
    url: withPath(s.url, '/services/collector/event'),
    // The channel header is needed only when indexer acknowledgement is on; harmless otherwise.
    headers: { 'user-agent': USER_AGENT, authorization: `Splunk ${s.token ?? ''}`, 'x-splunk-request-channel': randomUUID(), 'x-probaline-batch-id': batchId },
    body,
  };
}

const attr = (key: string, value: unknown) => ({
  key,
  value: typeof value === 'number' ? (Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value })
    : typeof value === 'boolean' ? { boolValue: value } : { stringValue: String(value) },
});

/** OpenTelemetry severity: stopped, denied and failed records are warnings. */
function severity(r: ExportRecord): { severityNumber: number; severityText: string } {
  return r.outcome === 'stopped' || r.outcome === 'denied' || r.outcome === 'failure'
    ? { severityNumber: 13, severityText: 'WARN' } : { severityNumber: 9, severityText: 'INFO' };
}

/** OTLP/HTTP logs, JSON encoding (any OpenTelemetry Collector, Datadog, Elastic, Grafana, Honeycomb…). */
function otlp(o: DestinationOptions, s: DestinationSecrets, records: ExportRecord[]): OutgoingRequest {
  const body = JSON.stringify({
    resourceLogs: [{
      resource: { attributes: [attr('service.name', 'probaline'), attr('probaline.tenant_id', records[0]?.tenantId ?? '')] },
      scopeLogs: [{
        scope: { name: 'probaline.log-export', version: '1' },
        logRecords: records.map((r) => ({
          timeUnixNano: String(BigInt(Date.parse(r.time)) * 1_000_000n),
          ...severity(r),
          body: { stringValue: JSON.stringify(r) },
          attributes: [
            attr('probaline.type', r.type), attr('probaline.action', r.action), attr('probaline.outcome', r.outcome),
            attr('probaline.actor.id', r.actor.id), attr('probaline.actor.type', r.actor.type), attr('probaline.record_id', r.id),
            ...(r.requestId ? [attr('probaline.request_id', r.requestId)] : []),
            ...(r.source?.ip ? [attr('client.address', r.source.ip)] : []),
            ...(r.actor.email ? [attr('user.email', r.actor.email)] : []),
          ],
        })),
      }],
    }],
  });
  return { url: withPath(s.url, '/v1/logs'), headers: { 'user-agent': USER_AGENT, ...(s.headers ?? {}) }, body };
}

export function buildRequest(o: DestinationOptions, s: DestinationSecrets, records: ExportRecord[], batchId: string, now = new Date()): OutgoingRequest {
  if (o.kind === 'splunk_hec') return splunk(o, s, records, batchId);
  if (o.kind === 'otlp_http') return otlp(o, s, records);
  return webhook(o, s, records, batchId, now);
}
