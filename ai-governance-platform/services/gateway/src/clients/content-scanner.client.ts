import axios from 'axios';
import FormData from 'form-data';
import { ContentScanResult } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:content-scanner-client');

export interface ScanUploadResponse {
  requestId: string;
  scanResults: ContentScanResult[];
  summary: { total: number; clean: number; flagged: number; blocked: number; errors: number };
  allowed: boolean;
  errors: { fileName: string; error: string }[];
}

export class ContentScannerClient {
  private baseUrl = process.env.CONTENT_SCANNER_URL || 'http://content-scanner:3004';

  async scanFiles(
    files: Array<{ name: string; buffer: Buffer; mimeType: string }>,
    tenantId: string,
    userId: string,
    requestId: string
  ): Promise<ScanUploadResponse> {
    const form = new FormData();

    for (const file of files) {
      form.append('files', file.buffer, {
        filename: file.name,
        contentType: file.mimeType,
      });
    }

    try {
      const response = await axios.post<ScanUploadResponse>(
        `${this.baseUrl}/v1/scan/upload`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'x-tenant-id': tenantId,
            'x-user-id': userId,
            'x-request-id': requestId,
          },
          timeout: 60000, // 60s for large files
        }
      );
      return response.data;
    } catch (err) {
      logger.error('Content scanner call failed', { error: err, requestId });
      // Fail open — log but don't block if scanner is unavailable
      return {
        requestId,
        scanResults: [],
        summary: { total: files.length, clean: 0, flagged: 0, blocked: 0, errors: files.length },
        allowed: true,
        errors: files.map((f) => ({ fileName: f.name, error: 'Scanner unavailable' })),
      };
    }
  }
}
