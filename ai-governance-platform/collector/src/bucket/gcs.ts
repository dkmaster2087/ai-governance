import { Bucket, Storage } from '@google-cloud/storage';
import { Store } from '../core/store';
import { LogBucket, LogObject } from './types';

/** Cloud Storage, signed in as the job's service account. `apiEndpoint` is for local testing only. */
export function gcsClient(apiEndpoint?: string): Storage {
  return apiEndpoint ? new Storage({ apiEndpoint, projectId: 'local' }) : new Storage();
}

/** Log entries a Cloud Logging sink writes to a bucket. */
export class GcsLogBucket implements LogBucket {
  readonly url: string;
  private bucket: Bucket;
  constructor(storage: Storage, name: string) {
    this.bucket = storage.bucket(name);
    this.url = `gs://${name}`;
  }

  async *list(prefix = ''): AsyncIterable<LogObject> {
    let pageToken: string | undefined;
    do {
      const [files, next] = await this.bucket.getFiles({ prefix: prefix || undefined, autoPaginate: false, maxResults: 1000, pageToken });
      for (const f of files) {
        yield { name: f.name, etag: String(f.metadata.generation ?? f.metadata.etag ?? f.metadata.updated ?? ''), updated: f.metadata.updated ? new Date(f.metadata.updated) : undefined };
      }
      pageToken = (next as { pageToken?: string } | null)?.pageToken;
    } while (pageToken);
  }

  async read(name: string): Promise<Buffer> {
    const [data] = await this.bucket.file(name).download();
    return data;
  }
}

/** Results in a bucket the customer owns. */
export class GcsStore implements Store {
  private bucket: Bucket;
  constructor(storage: Storage, name: string, private prefix = '') {
    this.bucket = storage.bucket(name);
  }

  async get(key: string) {
    try {
      const [data] = await this.bucket.file(this.prefix + key).download();
      return data.toString('utf8');
    } catch (e: any) {
      if (e?.code === 404) return null;
      throw e;
    }
  }

  async put(key: string, body: string, contentType = 'application/octet-stream') {
    await this.bucket.file(this.prefix + key).save(body, { contentType, resumable: false });
  }

  async list(prefix: string) {
    const [files] = await this.bucket.getFiles({ prefix: this.prefix + prefix });
    return files.map((f) => f.name.slice(this.prefix.length)).sort();
  }
}
