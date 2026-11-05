import { promises as fs } from 'fs';
import path from 'path';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageError } from './types';

/** Files such as audit archives: S3 (or any S3-compatible store), a local directory, or memory. */
export interface ObjectStore {
  readonly kind: 's3' | 'file' | 'memory';
  put(key: string, body: string | Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  list(prefix: string): Promise<string[]>;
}

function checkKey(key: string): string {
  const k = key.replace(/^\/+/, '');
  if (!k || k.split('/').some((p) => p === '..' || p === '.') || k.includes('\0')) throw new StorageError(`Invalid object key: ${key}`);
  return k;
}

export class S3ObjectStore implements ObjectStore {
  readonly kind = 's3' as const;
  constructor(private bucket: string, private s3: S3Client, private options: { kms?: boolean } = {}) {}

  async put(key: string, body: string | Buffer, contentType = 'application/octet-stream') {
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket, Key: checkKey(key), Body: body, ContentType: contentType,
      ...(this.options.kms ? { ServerSideEncryption: 'aws:kms' as const } : {}),
    }));
  }

  async get(key: string) {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }));
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async list(prefix: string) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
}

/** A directory on disk (a mounted volume on-premises or in Kubernetes). */
export class FileObjectStore implements ObjectStore {
  readonly kind = 'file' as const;
  constructor(private dir: string) {}

  private file(key: string) {
    return path.join(this.dir, ...checkKey(key).split('/'));
  }

  async put(key: string, body: string | Buffer) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, f);
  }

  async get(key: string) {
    return fs.readFile(this.file(key)).catch((err) => { if (err.code === 'ENOENT') return null; throw err; });
  }

  async list(prefix: string) {
    const out: string[] = [];
    const walk = async (dir: string, rel: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(dir, e.name), r);
        else if (!e.name.endsWith('.tmp') && r.startsWith(prefix)) out.push(r);
      }
    };
    await walk(this.dir, '');
    return out.sort();
  }
}

export class MemoryObjectStore implements ObjectStore {
  readonly kind = 'memory' as const;
  readonly objects = new Map<string, Buffer>();
  async put(key: string, body: string | Buffer) { this.objects.set(checkKey(key), Buffer.from(body)); }
  async get(key: string) { return this.objects.get(checkKey(key)) ?? null; }
  async list(prefix: string) { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort(); }
}
