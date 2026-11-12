import { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { createLogger } from '@ai-governance/utils';
import { requireAccess, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { DESTINATION_KINDS, DestinationSecrets } from '../log-export/formats';
import { RECORD_CHOICES, sampleRecord } from '../log-export/records';
import {
  checkDestinationUrl, Destination, DestinationError, destinationStore, MAX_DESTINATIONS, newSigningSecret, urlHint,
} from '../log-export/destinations';
import { describe, exporter } from '../log-export/exporter';

const logger = createLogger('gateway:log-export');

const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'content-type', 'transfer-encoding', 'connection', 'user-agent']);
const header = z.object({
  name: z.string().regex(/^[A-Za-z0-9-]{1,64}$/, 'Header names are letters, digits and dashes')
    .refine((n) => !FORBIDDEN_HEADERS.has(n.toLowerCase()) && !n.toLowerCase().startsWith('x-probaline-'), 'That header is set by Probaline'),
  value: z.string().min(1).max(2000),
});

const fields = {
  name: z.string().trim().min(1).max(60),
  url: z.string().trim().min(8).max(2000),
  recordTypes: z.array(z.enum(RECORD_CHOICES as unknown as [string, ...string[]])).min(1, 'Choose at least one kind of record').max(3),
  enabled: z.boolean(),
  token: z.string().trim().min(8).max(500),
  headers: z.array(header).max(10),
  splunkIndex: z.string().trim().regex(/^[A-Za-z0-9_-]{0,80}$/, 'Index names are letters, digits, dashes and underscores'),
  otlpEncoding: z.enum(['protobuf', 'json']),
};
const createBody = z.object({
  kind: z.enum(DESTINATION_KINDS as unknown as [string, ...string[]]),
  name: fields.name, url: fields.url, recordTypes: fields.recordTypes,
  enabled: fields.enabled.optional(), token: fields.token.optional(), headers: fields.headers.optional(), splunkIndex: fields.splunkIndex.optional(), otlpEncoding: fields.otlpEncoding.optional(),
});
const updateBody = z.object({
  name: fields.name, url: fields.url, recordTypes: fields.recordTypes, enabled: fields.enabled, token: fields.token, headers: fields.headers, splunkIndex: fields.splunkIndex, otlpEncoding: fields.otlpEncoding,
}).partial();

/** A destination as the dashboard sees it: no secrets, no lease, no queued records. */
export function view(d: Destination) {
  return {
    destinationId: d.destinationId, name: d.name, kind: d.kind, recordTypes: d.recordTypes, enabled: d.enabled, urlHint: d.urlHint,
    ...(d.secretHint ? { secretHint: d.secretHint } : {}), ...(d.headerNames ? { headerNames: d.headerNames } : {}), ...(d.splunkIndex ? { splunkIndex: d.splunkIndex } : {}),
    ...(d.kind === 'otlp_http' ? { otlpEncoding: d.otlpEncoding ?? 'protobuf' } : {}),
    createdAt: d.createdAt, updatedAt: d.updatedAt, deliveredCount: d.deliveredCount ?? 0, deadLetterCount: d.deadLetterCount ?? 0,
    lastDeliveredAt: d.lastDeliveredAt, lastAttemptAt: d.lastAttemptAt, lastError: d.lastError,
    ...(d.pending ? { retrying: { count: d.pending.records.length, attempts: d.pending.attempts, nextAttemptAt: new Date(d.pending.nextAttemptAt).toISOString() } } : {}),
  };
}

const bad = (message: string, code = 'INVALID_DESTINATION') => ({ error: message, code });
const firstIssue = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message) : 'Invalid request';
};

export async function logExportRoutes(app: FastifyInstance) {
  const store = () => destinationStore();

  app.get('/log-export', { preHandler: requireAccess(TENANT_READ) }, async (request) => {
    const [destinations, dead] = await Promise.all([store().list(request.tenantId), store().deadLetters(request.tenantId, 100)]);
    return { destinations: destinations.map(view), deadLetters: dead.length, maxDestinations: MAX_DESTINATIONS };
  });

  app.post('/log-export/destinations', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(bad(firstIssue(parsed.error)));
    const b = parsed.data;
    let url: URL;
    try { url = checkDestinationUrl(b.url); } catch (err) { return reply.status(400).send(bad((err as DestinationError).message)); }
    if (b.kind === 'splunk_hec' && !b.token) return reply.status(400).send(bad('The HEC token is required'));
    if ((await store().list(request.tenantId)).length >= MAX_DESTINATIONS) return reply.status(409).send(bad(`At most ${MAX_DESTINATIONS} destinations`, 'TOO_MANY_DESTINATIONS'));

    const signingSecret = b.kind === 'webhook' ? newSigningSecret() : undefined;
    const secrets: DestinationSecrets = {
      url: url.href,
      ...(signingSecret ? { signingSecret } : {}),
      ...(b.kind === 'splunk_hec' ? { token: b.token } : {}),
      ...(b.kind === 'otlp_http' && b.headers?.length ? { headers: Object.fromEntries(b.headers.map((h) => [h.name, h.value])) } : {}),
    };
    const now = new Date().toISOString();
    const destinationId = `dst_${randomBytes(6).toString('hex')}`;
    const d: Destination = {
      tenantId: request.tenantId, recordKey: `dest#${destinationId}`, destinationId, name: b.name, kind: b.kind as Destination['kind'],
      recordTypes: [...new Set(b.recordTypes)] as Destination['recordTypes'], enabled: b.enabled ?? true, urlHint: urlHint(url), secretRef: '',
      ...(signingSecret ? { secretHint: `…${signingSecret.slice(-4)}` } : b.token ? { secretHint: `…${b.token.slice(-4)}` } : {}),
      ...(b.kind === 'otlp_http' && b.headers?.length ? { headerNames: b.headers.map((h) => h.name) } : {}),
      ...(b.kind === 'splunk_hec' && b.splunkIndex ? { splunkIndex: b.splunkIndex } : {}),
      ...(b.kind === 'otlp_http' && b.otlpEncoding ? { otlpEncoding: b.otlpEncoding as Destination['otlpEncoding'] } : {}),
      createdAt: now, createdBy: request.userId, updatedAt: now,
      // Records from now on; history isn't replayed.
      cursorDecisions: { after: now, ids: [] }, cursorActivity: { after: now },
      deliveredCount: 0, deadLetterCount: 0, leaseId: 'none', leaseUntil: 0,
    };
    try {
      await store().create(d, secrets);
    } catch (err) {
      logger.error('Could not save log destination', { tenantId: request.tenantId, error: (err as Error).message });
      return reply.status(503).send(bad('The secret store couldn’t be reached; try again', 'SECRET_STORE_UNAVAILABLE'));
    }
    // The signing secret is shown once, like an API key.
    return reply.status(201).send({ destination: view(d), ...(signingSecret ? { signingSecret } : {}) });
  });

  app.patch('/log-export/destinations/:destinationId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { destinationId } = request.params as { destinationId: string };
    const d = await store().get(request.tenantId, destinationId);
    if (!d) return reply.status(404).send(bad('Destination not found', 'NOT_FOUND'));
    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(bad(firstIssue(parsed.error)));
    const b = parsed.data;
    const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (b.name !== undefined) set.name = b.name;
    if (b.enabled !== undefined) set.enabled = b.enabled;
    if (b.recordTypes) {
      const types = [...new Set(b.recordTypes)] as Destination['recordTypes'];
      set.recordTypes = types;
      // A type switched on starts from now, not from whenever the cursor last moved.
      const now = new Date().toISOString();
      if (types.includes('decisions') && !d.recordTypes.includes('decisions')) set.cursorDecisions = { after: now, ids: [] };
      const hadActivity = d.recordTypes.some((t) => t !== 'decisions');
      if (types.some((t) => t !== 'decisions') && !hadActivity) set.cursorActivity = { after: now };
    }
    if (b.splunkIndex !== undefined && d.kind === 'splunk_hec') set.splunkIndex = b.splunkIndex;
    if (b.otlpEncoding !== undefined && d.kind === 'otlp_http') set.otlpEncoding = b.otlpEncoding;

    if (b.url !== undefined || b.token !== undefined || b.headers !== undefined) {
      let secrets: DestinationSecrets;
      try { secrets = { ...(await store().secrets(d)) }; } catch {
        return reply.status(503).send(bad('The secret store couldn’t be reached; try again', 'SECRET_STORE_UNAVAILABLE'));
      }
      if (b.url !== undefined) {
        try { const u = checkDestinationUrl(b.url); secrets.url = u.href; set.urlHint = urlHint(u); } catch (err) { return reply.status(400).send(bad((err as Error).message)); }
      }
      if (b.token !== undefined && d.kind === 'splunk_hec') { secrets.token = b.token; set.secretHint = `…${b.token.slice(-4)}`; }
      if (b.headers !== undefined && d.kind === 'otlp_http') {
        secrets.headers = Object.fromEntries(b.headers.map((h) => [h.name, h.value]));
        set.headerNames = b.headers.map((h) => h.name);
      }
      set.secretRef = await store().saveSecrets(d, secrets);
    }
    const updated = await store().update(request.tenantId, destinationId, { set });
    return { destination: view(updated ?? d) };
  });

  app.delete('/log-export/destinations/:destinationId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { destinationId } = request.params as { destinationId: string };
    const d = await store().get(request.tenantId, destinationId);
    if (!d) return reply.status(404).send(bad('Destination not found', 'NOT_FOUND'));
    await store().remove(d);
    return { deleted: true, destinationId };
  });

  app.post('/log-export/destinations/:destinationId/rotate-secret', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { destinationId } = request.params as { destinationId: string };
    const d = await store().get(request.tenantId, destinationId);
    if (!d) return reply.status(404).send(bad('Destination not found', 'NOT_FOUND'));
    if (d.kind !== 'webhook') return reply.status(400).send(bad('Only webhooks have a signing secret'));
    const signingSecret = newSigningSecret();
    const secretRef = await store().saveSecrets(d, { ...(await store().secrets(d)), signingSecret });
    const updated = await store().update(request.tenantId, destinationId, { set: { secretRef, secretHint: `…${signingSecret.slice(-4)}`, updatedAt: new Date().toISOString() } });
    return { destination: view(updated ?? d), signingSecret };
  });

  /** Send one sample record now and say what the destination answered. */
  app.post('/log-export/destinations/:destinationId/test', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { destinationId } = request.params as { destinationId: string };
    const d = await store().get(request.tenantId, destinationId);
    if (!d) return reply.status(404).send(bad('Destination not found', 'NOT_FOUND'));
    const result = await exporter().send(d, [sampleRecord(request.tenantId, request.userId)]);
    return { ...result, message: result.ok ? `Delivered (${result.status}) in ${result.ms} ms` : describe(result) };
  });

  app.get('/log-export/dead-letters', { preHandler: requireAccess(TENANT_READ) }, async (request) => {
    const items = await store().deadLetters(request.tenantId, 100);
    return {
      items: items.map(({ records, ttl, recordKey: _k, ...dl }) => ({
        ...dl, keptUntil: new Date(ttl * 1000).toISOString(),
        firstRecordAt: records[0]?.time, lastRecordAt: records[records.length - 1]?.time,
        types: [...new Set(records.map((r) => r.type))],
      })),
    };
  });

  /** The records in a dead letter, to download. */
  app.get('/log-export/dead-letters/:entryId', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const { entryId } = request.params as { entryId: string };
    const dl = await store().deadLetter(request.tenantId, entryId);
    if (!dl) return reply.status(404).send(bad('Not found', 'NOT_FOUND'));
    const { recordKey: _k, ttl: _t, ...rest } = dl;
    return rest;
  });

  app.post('/log-export/dead-letters/:entryId/retry', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { entryId } = request.params as { entryId: string };
    const dl = await store().deadLetter(request.tenantId, entryId);
    if (!dl) return reply.status(404).send(bad('Not found', 'NOT_FOUND'));
    const d = await store().get(request.tenantId, dl.destinationId);
    if (!d) return reply.status(409).send(bad('Its destination was deleted; download the records instead', 'DESTINATION_GONE'));
    const result = await exporter().send(d, dl.records);
    if (result.ok) {
      await store().removeDeadLetter(dl);
      await store().update(request.tenantId, d.destinationId, { increment: { deliveredCount: dl.count }, set: { lastDeliveredAt: new Date().toISOString() } });
      return { ...result, message: `Delivered ${dl.count} records` };
    }
    await store().updateDeadLetter(dl, { error: describe(result), lastAttemptAt: new Date().toISOString() }, { attempts: 1 });
    return reply.status(502).send({ ...result, message: describe(result) });
  });

  app.delete('/log-export/dead-letters/:entryId', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const { entryId } = request.params as { entryId: string };
    const dl = await store().deadLetter(request.tenantId, entryId);
    if (!dl) return reply.status(404).send(bad('Not found', 'NOT_FOUND'));
    await store().removeDeadLetter(dl);
    return { deleted: true, entryId };
  });
}
