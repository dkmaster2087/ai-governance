import { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { GatewayService } from '../services/gateway.service';
import { ContentScannerClient } from '../clients/content-scanner.client';
import { PolicyViolationError } from '@ai-governance/utils';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:multimodal');

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]);

export async function multimodalRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  });

  const gatewayService = new GatewayService();
  const scannerClient = new ContentScannerClient();

  /**
   * POST /v1/chat/multimodal
   * Accepts multipart form:
   *   - prompt: text field (the user's message)
   *   - model: text field
   *   - files: one or more file attachments
   */
  app.post('/chat/multimodal', async (request, reply) => {
    const parts = request.parts();
    let prompt = '';
    let model = 'anthropic.claude-3-haiku-20240307-v1:0';
    const files: Array<{ name: string; buffer: Buffer; mimeType: string }> = [];

    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'prompt') prompt = part.value as string;
        if (part.fieldname === 'model') model = part.value as string;
      } else if (part.type === 'file') {
        if (!ALLOWED_MIME_TYPES.has(part.mimetype)) {
          return reply.status(415).send({
            error: 'UNSUPPORTED_FILE_TYPE',
            message: `File type ${part.mimetype} is not supported`,
            allowedTypes: [...ALLOWED_MIME_TYPES],
          });
        }
        const buffer = await part.toBuffer();
        files.push({ name: part.filename || 'unknown', buffer, mimeType: part.mimetype });
      }
    }

    if (!prompt && files.length === 0) {
      return reply.status(400).send({ error: 'EMPTY_REQUEST', message: 'Provide a prompt or at least one file' });
    }

    logger.info('Multimodal request received', {
      tenantId: request.tenantId,
      fileCount: files.length,
      promptLength: prompt.length,
    });

    // 1. Scan all files
    let enrichedPrompt = prompt;
    if (files.length > 0) {
      const scanResponse = await scannerClient.scanFiles(
        files,
        request.tenantId,
        request.userId,
        request.id
      );

      // Block if any file was blocked
      if (!scanResponse.allowed) {
        const blockedFiles = scanResponse.scanResults
          .filter((r) => r.status === 'blocked')
          .map((r) => `${r.fileName}: ${r.blockedReasons.join(', ')}`);

        throw new PolicyViolationError(
          `File scan blocked: ${blockedFiles.join('; ')}`
        );
      }

      // Append extracted text from files to the prompt
      const extractedTexts = scanResponse.scanResults
        .filter((r) => r.extractedText)
        .map((r) => `\n\n[Attached file: ${r.fileName}]\n${r.extractedText}`)
        .join('');

      if (extractedTexts) {
        enrichedPrompt = `${prompt}${extractedTexts}`;
      }

      // Log flagged files as warnings (don't block)
      const flagged = scanResponse.scanResults.filter((r) => r.status === 'flagged');
      if (flagged.length > 0) {
        logger.warn('Flagged files in multimodal request', {
          requestId: request.id,
          flaggedFiles: flagged.map((f) => ({ name: f.fileName, riskLevel: f.riskLevel })),
        });
      }
    }

    // 2. Process through normal gateway pipeline
    const result = await gatewayService.processRequest({
      tenantId: request.tenantId,
      userId: request.userId,
      appId: request.appId,
      model,
      messages: [{ role: 'user', content: enrichedPrompt }],
    });

    return reply.send({
      ...result,
      attachments: files.map((f) => ({ name: f.name, mimeType: f.mimeType, sizeBytes: f.buffer.length })),
    });
  });
}
