import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CatalogDataError } from '@ai-governance/catalog';
import { PLATFORM_ADMIN, TENANT_ADMIN, TENANT_READ, requireAccess } from '../auth/guards';
import { offlineLicensing } from '../licensing/offline-license';
import { catalogUpdater } from '../catalog/catalog-updater';
import { CatalogDocumentError, MAX_CATALOG_BYTES } from '../catalog/catalog-document';

/**
 * The AI service catalog this install uses (docs/ASSESSMENT.md, "The AI service catalog").
 *
 *   GET  /v1/catalog          which catalog is in use, where it came from, the last check (admins and auditors)
 *   POST /v1/catalog/check    download the published catalog now
 *   POST /v1/catalog/upload   apply a signed catalog file ({ document }), e.g. on a site with no internet access
 *
 * The catalog serves the whole install, so on a customer-run install the company's admins manage it; in Cloud,
 * where many companies share one install, only the platform admin does.
 */
export async function catalogRoutes(app: FastifyInstance) {
  const manage = requireAccess(offlineLicensing() ? TENANT_ADMIN : PLATFORM_ADMIN);

  app.get('/catalog', { preHandler: requireAccess(TENANT_READ) }, async () => catalogUpdater().state());

  app.post('/catalog/check', { preHandler: manage }, async () => {
    const outcome = await catalogUpdater().check();
    return { ...outcome, catalog: await catalogUpdater().state() };
  });

  app.post('/catalog/upload', { preHandler: manage, bodyLimit: MAX_CATALOG_BYTES + 64 * 1024 }, async (request, reply) => {
    const { document } = z.object({ document: z.string().min(1).max(MAX_CATALOG_BYTES) }).parse(request.body);
    try {
      const outcome = await catalogUpdater().accept(document, 'upload', request.userId);
      return { ...outcome, catalog: await catalogUpdater().state() };
    } catch (err) {
      if (err instanceof CatalogDocumentError || err instanceof CatalogDataError) {
        return reply.status(400).send({ error: err.message, code: err instanceof CatalogDocumentError ? `CATALOG_${err.code}` : 'CATALOG_MALFORMED' });
      }
      throw err;
    }
  });
}
