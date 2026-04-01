import {
  TextractClient,
  DetectDocumentTextCommand,
  AnalyzeDocumentCommand,
} from '@aws-sdk/client-textract';
import {
  ComprehendClient,
  DetectPiiEntitiesCommand,
} from '@aws-sdk/client-comprehend';
import { DocumentScanResult, PIIFinding, ScanRiskLevel } from '@ai-governance/types';
import { maskPII, createLogger } from '@ai-governance/utils';

const logger = createLogger('content-scanner:document');

// Sensitive data patterns beyond what Comprehend catches
const SENSITIVE_PATTERNS: Record<string, RegExp> = {
  AWS_ACCESS_KEY:    /AKIA[0-9A-Z]{16}/g,
  AWS_SECRET_KEY:    /[A-Za-z0-9/+=]{40}/g,
  PRIVATE_KEY:       /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  API_KEY_GENERIC:   /api[_-]?key[_-]?[:=]\s*['"]?[A-Za-z0-9_\-]{20,}/gi,
  PASSWORD_FIELD:    /password[_-]?[:=]\s*['"]?[^\s'"]{6,}/gi,
  CONNECTION_STRING: /(?:mongodb|postgresql|mysql|redis):\/\/[^\s]+/gi,
  CREDIT_CARD:       /\b(?:\d{4}[\s-]?){3}\d{4}\b/g,
  SSN:               /\b\d{3}-\d{2}-\d{4}\b/g,
  IBAN:              /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/g,
};

export class DocumentScanner {
  private textract = new TextractClient({ region: process.env.AWS_REGION || 'us-east-1' });
  private comprehend = new ComprehendClient({ region: process.env.AWS_REGION || 'us-east-1' });

  async scan(buffer: Buffer, mimeType: string): Promise<DocumentScanResult> {
    // Extract text based on file type
    const { extractedText, pageCount } = await this.extractText(buffer, mimeType);

    if (!extractedText || extractedText.trim().length === 0) {
      return {
        extractedText: '',
        pageCount: pageCount || 1,
        containsPII: false,
        piiFindings: [],
        sensitiveDataTypes: [],
        riskLevel: 'none',
      };
    }

    // Run PII detection and pattern matching in parallel
    const [piiResult, patternResult] = await Promise.all([
      this.detectPII(extractedText),
      this.detectSensitivePatterns(extractedText),
    ]);

    const allPiiFindings = piiResult.findings;
    const sensitiveDataTypes = [
      ...new Set([
        ...allPiiFindings.map((f) => f.type),
        ...patternResult,
      ]),
    ];

    const containsPII = allPiiFindings.length > 0 || patternResult.length > 0;
    const riskLevel = this.calculateRiskLevel(allPiiFindings, patternResult);

    logger.info('Document scan complete', {
      pageCount,
      textLength: extractedText.length,
      piiFindings: allPiiFindings.length,
      sensitivePatterns: patternResult.length,
      riskLevel,
    });

    return {
      extractedText: maskPII(extractedText),
      pageCount: pageCount || 1,
      containsPII,
      piiFindings: allPiiFindings,
      sensitiveDataTypes,
      riskLevel,
    };
  }

  private async extractText(buffer: Buffer, mimeType: string): Promise<{ extractedText: string; pageCount: number }> {
    // Plain text files — read directly
    if (mimeType === 'text/plain' || mimeType === 'text/csv') {
      return { extractedText: buffer.toString('utf-8'), pageCount: 1 };
    }

    // PDF and images — use Textract
    if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
      return this.extractWithTextract(buffer);
    }

    // DOCX — extract XML content (simplified; production would use mammoth.js)
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return this.extractDocxText(buffer);
    }

    // XLSX — extract cell values
    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      return this.extractXlsxText(buffer);
    }

    // Fallback — try as plain text
    return { extractedText: buffer.toString('utf-8', 0, Math.min(buffer.length, 50000)), pageCount: 1 };
  }

  private async extractWithTextract(buffer: Buffer): Promise<{ extractedText: string; pageCount: number }> {
    try {
      const result = await this.textract.send(
        new DetectDocumentTextCommand({
          Document: { Bytes: new Uint8Array(buffer) },
        })
      );

      const lines = (result.Blocks || [])
        .filter((b) => b.BlockType === 'LINE')
        .map((b) => b.Text || '');

      const pages = new Set(
        (result.Blocks || []).filter((b) => b.Page).map((b) => b.Page)
      );

      return {
        extractedText: lines.join('\n'),
        pageCount: pages.size || 1,
      };
    } catch (err) {
      logger.warn('Textract extraction failed, falling back to buffer read', { error: err });
      return { extractedText: buffer.toString('utf-8', 0, 10000), pageCount: 1 };
    }
  }

  private extractDocxText(buffer: Buffer): { extractedText: string; pageCount: number } {
    // Extract readable text from DOCX XML (simplified)
    const content = buffer.toString('utf-8');
    const textMatches = content.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
    const text = textMatches
      .map((m) => m.replace(/<[^>]+>/g, ''))
      .join(' ');
    return { extractedText: text, pageCount: 1 };
  }

  private extractXlsxText(buffer: Buffer): { extractedText: string; pageCount: number } {
    // Extract shared strings from XLSX (simplified)
    const content = buffer.toString('utf-8');
    const stringMatches = content.match(/<t[^>]*>([^<]+)<\/t>/g) || [];
    const text = stringMatches
      .map((m) => m.replace(/<[^>]+>/g, ''))
      .join(' ');
    return { extractedText: text, pageCount: 1 };
  }

  private async detectPII(text: string): Promise<{ findings: PIIFinding[] }> {
    // Chunk text for Comprehend's 5000 byte limit
    const chunks = this.chunkText(text, 4500);
    const allFindings: PIIFinding[] = [];
    let offset = 0;

    for (const chunk of chunks) {
      try {
        const result = await this.comprehend.send(
          new DetectPiiEntitiesCommand({ Text: chunk, LanguageCode: 'en' })
        );

        const findings = (result.Entities || []).map((e) => ({
          type: e.Type || 'UNKNOWN',
          score: e.Score || 0,
          beginOffset: (e.BeginOffset || 0) + offset,
          endOffset: (e.EndOffset || 0) + offset,
          maskedValue: `[${e.Type}]`,
        }));

        allFindings.push(...findings);
      } catch (err) {
        logger.warn('Comprehend PII detection failed for chunk', { error: err });
      }
      offset += chunk.length;
    }

    return { findings: allFindings };
  }

  private detectSensitivePatterns(text: string): string[] {
    const found: string[] = [];
    for (const [type, pattern] of Object.entries(SENSITIVE_PATTERNS)) {
      pattern.lastIndex = 0; // Reset regex state
      if (pattern.test(text)) {
        found.push(type);
      }
    }
    return found;
  }

  private chunkText(text: string, maxBytes: number): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      let end = start + maxBytes;
      if (end < text.length) {
        // Break at word boundary
        const lastSpace = text.lastIndexOf(' ', end);
        if (lastSpace > start) end = lastSpace;
      }
      chunks.push(text.slice(start, end));
      start = end;
    }
    return chunks;
  }

  private calculateRiskLevel(piiFindings: PIIFinding[], sensitivePatterns: string[]): ScanRiskLevel {
    const criticalPII = ['SSN', 'CREDIT_DEBIT_NUMBER', 'BANK_ACCOUNT_NUMBER', 'PASSPORT_NUMBER'];
    const criticalPatterns = ['AWS_ACCESS_KEY', 'AWS_SECRET_KEY', 'PRIVATE_KEY', 'CONNECTION_STRING'];

    if (
      piiFindings.some((f) => criticalPII.includes(f.type) && f.score > 0.9) ||
      sensitivePatterns.some((p) => criticalPatterns.includes(p))
    ) {
      return 'critical';
    }

    if (piiFindings.length > 10 || sensitivePatterns.length > 2) return 'high';
    if (piiFindings.length > 3 || sensitivePatterns.length > 0) return 'medium';
    if (piiFindings.length > 0) return 'low';
    return 'none';
  }
}
