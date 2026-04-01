import { FastifyInstance } from 'fastify';
import { ScanOrchestrator } from '../services/scan.orchestrator';
import { StorageService } from '../services/storage.service';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('content-scanner:routes');

export async function scanRoutes(app: FastifyInstance) {
  const orchestrator = new ScanOrchestrator();
  const storage = new StorageService();

  /**
   * POST /v1/scan/upload
   * Accepts multipart form with files + metadata.
   * Returns scan results for each file.
   * Called by the gateway before forwarding to AI provider.
   */
  app.post('/upload', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string;
    const userId = request.headers['x-user-id'] as string || 'anonymous';
    const requestId = request.headers['x-request-id'] as string || crypto.randomUUID();

    if (!tenantId) {
      return reply.status(401).send({ error: 'Missing x-tenant-id header' });
    }

    const parts = request.parts();
    const scanResults = [];
    const errors = [];

    for await (const part of parts) {
      if (part.type !== 'file') continue;

      const buffer = await part.toBuffer();
      const fileName = part.filename || 'unknown';
      const mimeType = part.mimetype;

      logger.info('Scanning file', { fileName, mimeType, sizeBytes: buffer.length, tenantId });

      try {
        // Upload to temp S3 location
        const fileId = await storage.uploadTemp(tenantId, requestId, fileName, buffer, mimeType);

        // Run scan pipeline
        const result = await orchestrator.scan({
          fileId,
          fileName,
          mimeType,
          buffer,
          tenantId,
          requestId,
          userId,
        });

        scanResults.push(result);

        // Clean up temp file
        await storage.deleteTemp(fileId);
      } catch (err) {
        logger.error('File scan failed', { fileName, error: err });
        errors.push({ fileName, error: (err as Error).message });
      }
    }

    const blocked = scanResults.filter((r) => r.status === 'blocked');
    const flagged = scanResults.filter((r) => r.status === 'flagged');

    return reply.send({
      requestId,
      scanResults,
      summary: {
        total: scanResults.length,
        clean: scanResults.filter((r) => r.status === 'clean').length,
        flagged: flagged.length,
        blocked: blocked.length,
        errors: errors.length,
      },
      allowed: blocked.length === 0,
      errors,
    });
  });

  /**
   * POST /v1/scan/text
   * Scan raw text content (for inline base64 images or extracted text).
   */
  app.post('/text', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string;
    const { text, requestId } = request.body as { text: string; requestId?: string };

    if (!tenantId || !text) {
      return reply.status(400).send({ error: 'Missing tenantId or text' });
    }

    const result = await orchestrator.scanText(text, tenantId, requestId || crypto.randomUUID());
    return reply.send(result);
  });
}
