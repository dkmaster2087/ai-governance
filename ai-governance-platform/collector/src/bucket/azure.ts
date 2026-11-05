import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { Store } from '../core/store';
import { LogBucket, LogObject } from './types';

/**
 * A storage account, by URL (signed in with the job's managed identity) or, for local testing, by
 * connection string (Azurite).
 */
export function blobService(account: { url?: string; connectionString?: string }): BlobServiceClient {
  if (account.connectionString) return BlobServiceClient.fromConnectionString(account.connectionString);
  if (!account.url) throw new Error('Set the storage account URL or a connection string');
  return new BlobServiceClient(account.url, new DefaultAzureCredential());
}

/** Diagnostic logs in one container, e.g. insights-logs-azurefirewall. */
export class AzureLogContainer implements LogBucket {
  readonly url: string;
  private container: ContainerClient;
  constructor(service: BlobServiceClient, name: string) {
    this.container = service.getContainerClient(name);
    this.url = `azure://${service.accountName}/${name}`;
  }

  async *list(prefix = ''): AsyncIterable<LogObject> {
    for await (const b of this.container.listBlobsFlat({ prefix: prefix || undefined })) {
      yield { name: b.name, etag: String(b.properties.etag ?? b.properties.lastModified?.toISOString() ?? ''), updated: b.properties.lastModified };
    }
  }

  async read(name: string): Promise<Buffer> {
    return this.container.getBlobClient(name).downloadToBuffer();
  }
}

/** Results in a container the customer owns. */
export class AzureBlobStore implements Store {
  private container: ContainerClient;
  constructor(service: BlobServiceClient, name: string, private prefix = '') {
    this.container = service.getContainerClient(name);
  }

  async get(key: string) {
    try {
      return (await this.container.getBlobClient(this.prefix + key).downloadToBuffer()).toString('utf8');
    } catch (e: any) {
      if (e?.statusCode === 404) return null;
      throw e;
    }
  }

  async put(key: string, body: string, contentType = 'application/octet-stream') {
    await this.container.getBlockBlobClient(this.prefix + key).upload(body, Buffer.byteLength(body), { blobHTTPHeaders: { blobContentType: contentType } });
  }

  async list(prefix: string) {
    const out: string[] = [];
    for await (const b of this.container.listBlobsFlat({ prefix: this.prefix + prefix })) out.push(b.name.slice(this.prefix.length));
    return out.sort();
  }
}
