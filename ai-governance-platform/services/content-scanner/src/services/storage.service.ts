import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createLogger } from '@ai-governance/utils';
import { randomUUID } from 'crypto';

const logger = createLogger('content-scanner:storage');

export class StorageService {
  private s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    forcePathStyle: true, // Required for LocalStack
  });
  private bucket = process.env.SCAN_TEMP_BUCKET || process.env.AUDIT_LOG_BUCKET || 'ai-gov-audit-logs-dev-000000000000';

  async uploadTemp(
    tenantId: string,
    requestId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<string> {
    const fileId = randomUUID();
    const key = `temp-scans/${tenantId}/${requestId}/${fileId}/${fileName}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        // Auto-expire temp files after 1 hour via S3 lifecycle rule
        Metadata: {
          'x-tenant-id': tenantId,
          'x-request-id': requestId,
          'x-temp': 'true',
        },
      })
    );

    logger.info('Uploaded temp scan file', { key, sizeBytes: buffer.length });
    return key; // Return S3 key as fileId
  }

  async deleteTemp(s3Key: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: s3Key })
      );
    } catch (err) {
      // Non-fatal — lifecycle rule will clean up
      logger.warn('Failed to delete temp scan file', { s3Key, error: err });
    }
  }
}
