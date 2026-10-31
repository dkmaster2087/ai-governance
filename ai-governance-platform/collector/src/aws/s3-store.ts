import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Store } from '../core/store';

/** Results in a bucket in the customer's own account, encrypted at rest by the bucket's settings. */
export class S3Store implements Store {
  constructor(private readonly s3: S3Client, private readonly bucket: string, private readonly prefix = '') {}

  async get(key: string) {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.prefix + key }));
      return (await res.Body?.transformToString('utf8')) ?? null;
    } catch (e: any) {
      if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async put(key: string, body: string, contentType = 'application/octet-stream') {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.prefix + key, Body: body, ContentType: contentType }));
  }

  async list(prefix: string) {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.prefix + prefix, ContinuationToken: token }));
      for (const o of res.Contents ?? []) if (o.Key) out.push(o.Key.slice(this.prefix.length));
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out.sort();
  }
}

/** Read a whole object as bytes (log files are read, never changed). */
export async function readObject(s3: S3Client, bucket: string, key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}
