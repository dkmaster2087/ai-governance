import { ContentScanResult, ContentType, ScanRiskLevel, ScanStatus } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { ImageScanner } from './image.scanner';
import { DocumentScanner } from './document.scanner';
import { randomUUID } from 'crypto';

const logger = createLogger('content-scanner:orchestrator');

const MIME_TO_CONTENT_TYPE: Record<string, ContentType> = {
  'image/jpeg':       'image',
  'image/jpg':        'image',
  'image/png':        'image',
  'image/gif':        'image',
  'image/webp':       'image',
  'image/bmp':        'image',
  'application/pdf':  'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/msword': 'document',
  'text/plain':       'document',
  'text/csv':         'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.ms-excel': 'spreadsheet',
};

// Risk levels that result in a block (configurable per tenant in production)
const BLOCK_RISK_LEVELS: ScanRiskLevel[] = ['critical'];
const FLAG_RISK_LEVELS: ScanRiskLevel[] = ['high', 'medium'];

interface ScanInput {
  fileId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  tenantId: string;
  requestId: string;
  userId: string;
}

export class ScanOrchestrator {
  private imageScanner = new ImageScanner();
  private documentScanner = new DocumentScanner();

  async scan(input: ScanInput): Promise<ContentScanResult> {
    const start = Date.now();
    const scanId = randomUUID();
    const contentType = MIME_TO_CONTENT_TYPE[input.mimeType] ?? 'document';

    logger.info('Starting content scan', {
      scanId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      contentType,
      sizeBytes: input.buffer.length,
    });

    try {
      let riskLevel: ScanRiskLevel = 'none';
      let piiTypes: string[] = [];
      let blockedReasons: string[] = [];
      let extractedText: string | undefined;
      let imageScan;
      let documentScan;

      if (contentType === 'image') {
        imageScan = await this.imageScanner.scan(input.buffer, input.mimeType);
        riskLevel = imageScan.riskLevel;
        piiTypes = imageScan.piiFindings.map((f) => f.type);
        extractedText = imageScan.detectedText;

        // Check for blocked moderation labels
        const blockedLabels = imageScan.moderationLabels
          .filter((l) => this.imageScanner.isBlockLabel(l.name) && l.confidence > 80);
        if (blockedLabels.length > 0) {
          blockedReasons.push(
            `Image contains prohibited content: ${blockedLabels.map((l) => l.name).join(', ')}`
          );
        }
        // PII in images is flagged (not blocked) — masking handles it
      } else {
        documentScan = await this.documentScanner.scan(input.buffer, input.mimeType);
        riskLevel = documentScan.riskLevel;
        piiTypes = documentScan.sensitiveDataTypes;
        extractedText = documentScan.extractedText; // Already masked

        // Only block on critical risk (e.g. AWS keys, private keys)
        if (riskLevel === 'critical') {
          blockedReasons.push(
            `Document contains critical sensitive data: ${documentScan.sensitiveDataTypes.join(', ')}`
          );
        }
      }

      // Determine final status
      const status = this.determineStatus(riskLevel, blockedReasons);
      const riskScore = this.riskLevelToScore(riskLevel);

      const result: ContentScanResult = {
        scanId,
        fileId: input.fileId,
        requestId: input.requestId,
        tenantId: input.tenantId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
        status,
        riskLevel,
        riskScore,
        contentType,
        imageScan,
        documentScan,
        extractedText,
        blockedReasons,
        piiDetected: piiTypes.length > 0,
        piiTypes,
        scannedAt: new Date().toISOString(),
        scanDurationMs: Date.now() - start,
      };

      logger.info('Scan complete', {
        scanId,
        status,
        riskLevel,
        riskScore,
        piiTypes: piiTypes.length,
        durationMs: result.scanDurationMs,
      });

      return result;
    } catch (err) {
      logger.error('Scan failed', { scanId, fileName: input.fileName, error: err });
      return {
        scanId,
        fileId: input.fileId,
        requestId: input.requestId,
        tenantId: input.tenantId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
        status: 'error',
        riskLevel: 'none',
        riskScore: 0,
        contentType,
        blockedReasons: [`Scan error: ${(err as Error).message}`],
        piiDetected: false,
        piiTypes: [],
        scannedAt: new Date().toISOString(),
        scanDurationMs: Date.now() - start,
      };
    }
  }

  async scanText(text: string, tenantId: string, requestId: string): Promise<Partial<ContentScanResult>> {
    const start = Date.now();
    const result = await this.documentScanner.scan(Buffer.from(text), 'text/plain');
    return {
      scanId: randomUUID(),
      requestId,
      tenantId,
      status: result.containsPII ? 'flagged' : 'clean',
      riskLevel: result.riskLevel,
      riskScore: this.riskLevelToScore(result.riskLevel),
      extractedText: result.extractedText,
      piiDetected: result.containsPII,
      piiTypes: result.sensitiveDataTypes,
      blockedReasons: [],
      scannedAt: new Date().toISOString(),
      scanDurationMs: Date.now() - start,
    };
  }

  private determineStatus(riskLevel: ScanRiskLevel, blockedReasons: string[]): ScanStatus {
    if (BLOCK_RISK_LEVELS.includes(riskLevel) || blockedReasons.length > 0) return 'blocked';
    if (FLAG_RISK_LEVELS.includes(riskLevel)) return 'flagged';
    return 'clean';
  }

  private riskLevelToScore(level: ScanRiskLevel): number {
    const scores: Record<ScanRiskLevel, number> = {
      none: 0, low: 25, medium: 50, high: 75, critical: 100,
    };
    return scores[level];
  }
}
