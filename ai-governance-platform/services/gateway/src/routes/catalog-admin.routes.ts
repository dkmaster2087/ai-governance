import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AiServiceData, CatalogData, CatalogDataError, serviceById } from '@ai-governance/catalog';
import { PLATFORM_ADMIN, requireAccess } from '../auth/guards';
import { Candidate, CandidateStatus, work } from '../catalog/discovery/catalog-work';
import { draftCatalog, isPublisher, publishCatalog } from '../catalog/discovery/publisher';
import { classifyCandidate, defaultModel, isDiscoveryOn, runDiscovery } from '../catalog/discovery/discovery';
import { candidateDomain, SOURCES } from '../catalog/discovery/sources';

/**
 * The AI service catalog's upkeep (Cloud's platform admin; docs/ASSESSMENT.md, "Finding new AI services"):
 *
 *   GET  /v1/platform/catalog                      published edition, unpublished changes, sources, counts
 *   GET  /v1/platform/catalog/candidates?status=   the review queue
 *   POST /v1/platform/catalog/candidates           suggest a domain by hand ({ domain, note })
 *   POST /v1/platform/catalog/candidates/:domain/classify | approve | reject | restore
 *   DELETE /v1/platform/catalog/services/:id       remove a reviewed addition or change
 *   POST /v1/platform/catalog/advisories           add an advisory; DELETE …/advisories/:id
 *   POST /v1/platform/catalog/discover             read the sources now
 *   POST /v1/platform/catalog/publish              sign and publish a new edition
 *
 *   GET  /public/catalog/v1/latest.json            the signed catalog installs download (no sign-in)
 *
 * Only an install that publishes (CATALOG_PUBLISHER=on, i.e. Cloud) answers these.
 */

const CATEGORY = z.enum(['chat', 'model_api', 'coding', 'cloud_ai', 'work_app']);
const serviceBody = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Use lower-case letters, digits and hyphens'),
  name: z.string().trim().min(1).max(80),
  vendor: z.string().trim().min(1).max(80),
  category: CATEGORY,
  businessTerms: z.enum(['offered', 'unknown']),
  domains: z.array(z.string().trim().toLowerCase()).min(1).max(20),
  appNames: z.array(z.string().trim().toLowerCase().min(1).max(80)).max(10).optional(),
  url: z.string().url().startsWith('https://').optional(),
});

const fail = (statusCode: number, message: string, code: string) => Object.assign(new Error(message), { statusCode, code });

function published(doc: string | undefined): CatalogData | null {
  if (!doc) return null;
  try { return JSON.parse(Buffer.from(JSON.parse(doc).payload, 'base64url').toString('utf8')); } catch { return null; }
}

/** Services and advisories that differ between the draft and the published edition. */
function changes(draft: CatalogData, pub: CatalogData | null) {
  const before = new Map((pub?.services ?? []).map((s) => [s.id, JSON.stringify(s)]));
  const after = new Map(draft.services.map((s) => [s.id, JSON.stringify(s)]));
  const added = [...after.keys()].filter((id) => !before.has(id));
  const changed = [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id));
  const removed = [...before.keys()].filter((id) => !after.has(id));
  const advisories = JSON.stringify(draft.advisories ?? []) !== JSON.stringify(pub?.advisories ?? []);
  return { added, changed, removed, advisories, any: added.length + changed.length + removed.length > 0 || advisories };
}

export async function catalogAdminRoutes(app: FastifyInstance) {
  // The download installs make: public, cacheable for five minutes, and a 304 when unchanged.
  app.get('/public/catalog/v1/latest.json', async (request, reply) => {
    if (!isPublisher()) return reply.status(404).send({ error: 'This install doesn’t publish a catalog', code: 'NOT_FOUND' });
    const p = await work.published();
    if (!p) return reply.status(503).send({ error: 'No catalog has been published yet', code: 'NOT_PUBLISHED' });
    const etag = `"catalog-${p.sequence}"`;
    reply.header('etag', etag).header('cache-control', 'public, max-age=300').header('content-type', 'application/json');
    if (request.headers['if-none-match'] === etag) return reply.status(304).send();
    return reply.send(p.document);
  });

  const admin = { preHandler: [requireAccess(PLATFORM_ADMIN), async () => { if (!isPublisher()) throw fail(404, 'This install doesn’t publish the catalog', 'NOT_PUBLISHER'); }] };
  const by = (r: { userId: string }) => r.userId;

  app.get('/v1/platform/catalog', admin, async () => {
    const p = await work.published();
    const now = new Date();
    const draft = await draftCatalog((p?.sequence ?? 0) + 1, 'draft', now.toISOString());
    const counts: Record<CandidateStatus, number> = { new: 0, classified: 0, dismissed: 0, approved: 0, rejected: 0 };
    for (const c of await work.candidates()) counts[c.status]++;
    const runs = await work.runs();
    return {
      published: p ? { version: p.version, sequence: p.sequence, publishedAt: p.publishedAt, services: p.services, by: p.by } : null,
      unpublished: changes(draft, published(p?.document)),
      services: (await work.services()).sort((a, b) => b.at.localeCompare(a.at)),
      advisories: (await work.advisories()).sort((a, b) => b.at.localeCompare(a.at)),
      candidates: counts,
      discovery: isDiscoveryOn(),
      classifier: defaultModel() !== null,
      sources: SOURCES.map((s) => ({ name: s.name, label: s.label, everyMinutes: s.everyMinutes, ...(runs.find((r) => r.name === s.name) ?? {}) })),
    };
  });

  app.get('/v1/platform/catalog/candidates', admin, async (request) => {
    const { status } = z.object({ status: z.enum(['review', 'new', 'classified', 'dismissed', 'approved', 'rejected']).default('review') }).parse(request.query);
    const wanted = status === 'review' ? ['new', 'classified'] : [status];
    return (await work.candidates())
      .filter((c) => wanted.includes(c.status))
      // Likely AI services first, then by when they were seen.
      .sort((a, b) => Number(b.suggestion?.isAiService ?? 0) - Number(a.suggestion?.isAiService ?? 0) || b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, 500);
  });

  app.post('/v1/platform/catalog/candidates', admin, async (request) => {
    const { domain: raw, note } = z.object({ domain: z.string().trim().min(3).max(253), note: z.string().trim().max(300).optional() }).parse(request.body);
    const domain = candidateDomain(raw.replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
    if (!domain) throw fail(400, 'That isn’t a domain that can be reviewed', 'INVALID_DOMAIN');
    const existing = await work.candidate(domain);
    if (existing) return existing;
    const at = new Date().toISOString();
    const c: Candidate = { domain, status: 'new', sources: [{ source: 'manual', title: `Suggested by ${by(request)}`, at }], firstSeenAt: at, lastSeenAt: at, ...(note ? { note } : {}) };
    await work.putCandidate(c);
    return c;
  });

  const candidate = async (domain: string) => {
    const c = await work.candidate(domain);
    if (!c) throw fail(404, 'No such candidate', 'NOT_FOUND');
    return c;
  };

  app.post('/v1/platform/catalog/candidates/:domain/classify', admin, async (request) => {
    const c = await candidate((request.params as { domain: string }).domain);
    const model = defaultModel();
    if (!model) throw fail(409, 'The classifier is off (CATALOG_CLASSIFIER=off)', 'CLASSIFIER_OFF');
    await classifyCandidate({ ...c, status: c.status === 'dismissed' ? 'new' : c.status }, model);
    return candidate(c.domain);
  });

  // Approve: a new service, or more domains for one already in the catalog (addTo).
  app.post('/v1/platform/catalog/candidates/:domain/approve', admin, async (request) => {
    const c = await candidate((request.params as { domain: string }).domain);
    const body = z.object({ service: serviceBody.optional(), addTo: z.string().optional(), domains: z.array(z.string().trim().toLowerCase()).max(20).optional() })
      .refine((b) => !!b.service !== !!b.addTo, { message: 'Give either a new service or addTo (an existing service id)' })
      .parse(request.body);
    let service: AiServiceData;
    if (body.addTo) {
      const reviewed = (await work.services()).find((s) => s.service.id === body.addTo)?.service;
      const builtIn = serviceById(body.addTo);
      const base: AiServiceData | undefined = reviewed ?? (builtIn ? { ...builtIn, patterns: builtIn.patterns?.map((p) => p.source) } : undefined);
      if (!base) throw fail(404, `No service ${body.addTo} in the catalog`, 'NOT_FOUND');
      const domains = body.domains?.length ? body.domains : c.suggestion?.domains ?? [c.domain];
      service = { ...base, domains: [...new Set([...base.domains, ...domains])] };
    } else {
      service = { ...body.service!, ...(body.service!.appNames?.length ? {} : { appNames: undefined }) };
      if (serviceById(service.id) || (await work.services()).some((s) => s.service.id === service.id)) {
        throw fail(409, `A service with id ${service.id} is already in the catalog; use “add to” instead`, 'DUPLICATE_ID');
      }
    }
    // Check the whole catalog with this change, exactly as installs will.
    try {
      await draftCatalog(Number.MAX_SAFE_INTEGER, 'check', new Date().toISOString(), (m) => m.set(service.id, service));
    } catch (err) {
      if (err instanceof CatalogDataError) throw fail(400, err.message, 'INVALID_SERVICE');
      throw err;
    }
    const at = new Date().toISOString();
    await work.putService({ service, by: by(request), at, fromDomain: c.domain });
    await work.putCandidate({ ...c, status: 'approved', serviceId: service.id, decidedBy: by(request), decidedAt: at });
    return { candidate: await candidate(c.domain), service };
  });

  app.post('/v1/platform/catalog/candidates/:domain/reject', admin, async (request) => {
    const c = await candidate((request.params as { domain: string }).domain);
    const { note } = z.object({ note: z.string().trim().max(300).optional() }).parse(request.body ?? {});
    await work.putCandidate({ ...c, status: 'rejected', decidedBy: by(request), decidedAt: new Date().toISOString(), ...(note ? { note } : {}) });
    return candidate(c.domain);
  });

  // Back to the queue: a dismissed or rejected candidate someone wants to look at again.
  app.post('/v1/platform/catalog/candidates/:domain/restore', admin, async (request) => {
    const c = await candidate((request.params as { domain: string }).domain);
    if (c.status === 'approved') throw fail(409, 'Remove the service from the catalog instead', 'APPROVED');
    const { decidedBy: _b, decidedAt: _a, ...rest } = c;
    await work.putCandidate({ ...rest, status: c.suggestion ? 'classified' : 'new' });
    return candidate(c.domain);
  });

  app.delete('/v1/platform/catalog/services/:id', admin, async (request) => {
    const { id } = request.params as { id: string };
    if (!(await work.services()).some((s) => s.service.id === id)) throw fail(404, 'Only services added or changed here can be removed', 'NOT_FOUND');
    await work.deleteService(id);
    return { removed: id };
  });

  app.post('/v1/platform/catalog/advisories', admin, async (request) => {
    const a = z.object({
      serviceId: z.string(), severity: z.enum(['info', 'warning', 'critical']),
      title: z.string().trim().min(1).max(120), detail: z.string().trim().min(1).max(600), url: z.string().url().startsWith('https://').optional(),
    }).parse(request.body);
    const known = serviceById(a.serviceId) || (await work.services()).some((s) => s.service.id === a.serviceId);
    if (!known) throw fail(404, `No service ${a.serviceId} in the catalog`, 'NOT_FOUND');
    const at = new Date().toISOString();
    const advisory = { id: `adv-${Date.now().toString(36)}`, ...a, publishedAt: at };
    await work.putAdvisory({ advisory, by: by(request), at });
    return advisory;
  });

  app.delete('/v1/platform/catalog/advisories/:id', admin, async (request) => {
    await work.deleteAdvisory((request.params as { id: string }).id);
    return { removed: true };
  });

  app.post('/v1/platform/catalog/discover', admin, async () => runDiscovery({}, true));

  app.post('/v1/platform/catalog/publish', admin, async (request) => {
    const p = await publishCatalog(by(request));
    return { version: p.version, sequence: p.sequence, publishedAt: p.publishedAt, services: p.services };
  });
}
