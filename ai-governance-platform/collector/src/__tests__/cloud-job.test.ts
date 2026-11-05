/**
 * The in-cloud collector job. The logic runs against an in-memory bucket every time; against Azure Blob
 * Storage (Azurite) and Cloud Storage (fake-gcs-server) when they are running:
 *   AZURITE_CONNECTION_STRING="DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=…;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;" \
 *   GCS_TEST_ENDPOINT=http://localhost:4443 npx jest cloud-job
 */
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { gzipSync } from 'zlib';
import { FileStore, loadSightings } from '../core/store';
import { mergeSightings } from '../core/sightings';
import { runBucketJob } from '../bucket/job';
import { LogBucket, LogObject } from '../bucket/types';
import { runCloudJob } from '../bucket/run-job';

const NOW = new Date('2026-11-05T12:00:00Z');
const FW = '/SUBSCRIPTIONS/1/RESOURCEGROUPS/N/PROVIDERS/MICROSOFT.NETWORK/AZUREFIREWALLS/FW';
const fwLine = (host: string, ip: string, minute = 0) => JSON.stringify({
  time: `2026-11-05T09:${String(minute).padStart(2, '0')}:00Z`, resourceId: FW, category: 'AZFWApplicationRule', properties: { SourceIp: ip, Fqdn: host },
});
const gcpLine = (host: string, vm: string) => JSON.stringify({
  logName: 'projects/p/logs/dns.googleapis.com%2Fdns_queries', timestamp: '2026-11-05T10:00:00Z', resource: { type: 'dns_query' },
  jsonPayload: { queryName: `${host}.`, sourceIP: '10.0.0.1', vmInstanceName: vm },
});

class MemoryBucket implements LogBucket {
  readonly url = 'mem://logs';
  files = new Map<string, { body: Buffer; etag: number }>();
  reads = 0;
  set(name: string, body: string | Buffer) {
    const prev = this.files.get(name);
    this.files.set(name, { body: Buffer.from(body), etag: (prev?.etag ?? 0) + 1 });
  }
  async *list(prefix = ''): AsyncIterable<LogObject> {
    for (const [name, f] of this.files) if (name.startsWith(prefix)) yield { name, etag: String(f.etag) };
  }
  async read(name: string) { this.reads++; return this.files.get(name)!.body; }
}

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'probaline-cloudjob-'));
  const store = new FileStore(dir);
  const counts = async () => Object.fromEntries(mergeSightings(await loadSightings(store, '2026-01-01', '2027-12-31')).map((r) => [`${r.domain}|${r.who}|${r.source}`, r.count]));
  return { dir, store, counts };
}

describe('in-cloud collector job', () => {
  it('reads new files once, re-reads files that change, and builds the report', async () => {
    const { store, counts } = await tempStore();
    const bucket = new MemoryBucket();
    bucket.set('a/PT1H.json', `${fwLine('api.openai.com', '10.0.0.4')}\n${fwLine('www.bbc.co.uk', '10.0.0.4', 1)}\n`);
    bucket.set('b/logs.json.gz', gzipSync(`${gcpLine('claude.ai', 'etl-runner')}\n`));

    const first = await runBucketJob({ buckets: [bucket], store, now: NOW });
    expect(first).toMatchObject({ files: 2, matched: 2, pending: 0, report: 'reports/report-2026-11-05.html' });
    expect(await counts()).toEqual({ 'api.openai.com|ip:10.0.0.4|azure_firewall': 1, 'claude.ai|host:etl-runner|gcp_dns': 1 });
    expect(await store.get('reports/latest.html')).toContain('Azure Firewall');

    // Nothing new: nothing read.
    bucket.reads = 0;
    expect((await runBucketJob({ buckets: [bucket], store, now: NOW })).files).toBe(0);
    expect(bucket.reads).toBe(0);

    // Azure appends to the hour's file: it's read again and replaces its own results, not adding to them.
    bucket.set('a/PT1H.json', `${fwLine('api.openai.com', '10.0.0.4')}\n${fwLine('api.openai.com', '10.0.0.4', 2)}\n`);
    expect((await runBucketJob({ buckets: [bucket], store, now: NOW })).files).toBe(1);
    expect((await counts())['api.openai.com|ip:10.0.0.4|azure_firewall']).toBe(2);
  });

  it('stops at the file limit and picks up the rest next run', async () => {
    const { store } = await tempStore();
    const bucket = new MemoryBucket();
    for (let i = 0; i < 5; i++) bucket.set(`f${i}.json`, fwLine('api.openai.com', `10.0.0.${i}`));
    expect(await runBucketJob({ buckets: [bucket], store, now: NOW, maxFiles: 3 })).toMatchObject({ files: 3, pending: 2 });
    expect(await runBucketJob({ buckets: [bucket], store, now: NOW, maxFiles: 3 })).toMatchObject({ files: 2, pending: 0 });
  });

  it('only reads under the prefixes it is given', async () => {
    const { store } = await tempStore();
    const bucket = new MemoryBucket();
    bucket.set('insights-logs-azfwapplicationrule/x.json', fwLine('api.openai.com', '10.0.0.1'));
    bucket.set('other/x.json', fwLine('api.openai.com', '10.0.0.2'));
    expect((await runBucketJob({ buckets: [bucket], store, now: NOW, prefixes: ['insights-logs-'] })).files).toBe(1);
  });
});

const azurite = process.env.AZURITE_CONNECTION_STRING;
(azurite ? describe : describe.skip)('against Azure Blob Storage (Azurite)', () => {
  it('reads diagnostic log containers and writes results to a results container', async () => {
    const { BlobServiceClient } = await import('@azure/storage-blob');
    const svc = BlobServiceClient.fromConnectionString(azurite!);
    const run = Date.now().toString(36);
    const logs = svc.getContainerClient(`insights-logs-azfwapplicationrule-${run}`);
    const results = svc.getContainerClient(`probaline-results-${run}`);
    await logs.create();
    await results.create();
    const blob = `resourceId=${FW}/y=2026/m=11/d=05/h=09/m=00/PT1H.json`;
    const body = `${fwLine('api.anthropic.com', '10.9.0.1')}\n${fwLine('pypi.org', '10.9.0.1', 3)}\n`;
    await logs.getBlockBlobClient(blob).upload(body, Buffer.byteLength(body));

    Object.assign(process.env, { CLOUD: 'azure', AZURE_STORAGE_CONNECTION_STRING: azurite, LOG_CONTAINERS: logs.containerName, RESULTS_CONTAINER: results.containerName, COMPANY: 'Acme' });
    const r = await runCloudJob(() => undefined);
    expect(r).toMatchObject({ files: 1, matched: 1 });
    const report = (await results.getBlobClient('reports/latest.html').downloadToBuffer()).toString();
    expect(report).toContain('Anthropic API');
    expect((await runCloudJob(() => undefined)).files).toBe(0);
    await logs.delete();
    await results.delete();
  }, 60_000);
});

const gcs = process.env.GCS_TEST_ENDPOINT;
(gcs ? describe : describe.skip)('against Cloud Storage (fake-gcs-server)', () => {
  it('reads a log sink bucket and writes results to a results bucket', async () => {
    const { Storage } = await import('@google-cloud/storage');
    const storage = new Storage({ apiEndpoint: gcs, projectId: 'local' });
    const run = Date.now().toString(36);
    const [logs] = await storage.createBucket(`acme-logs-${run}`);
    const [results] = await storage.createBucket(`acme-results-${run}`);
    await logs.file('dns.googleapis.com/dns_queries/2026/11/05/10:00:00_10:59:59_S0.json').save(`${gcpLine('api.openai.com', 'billing-worker-1')}\n`, { resumable: false });

    Object.assign(process.env, { CLOUD: 'gcp', GCS_API_ENDPOINT: gcs, LOG_BUCKETS: logs.name, RESULTS_BUCKET: results.name });
    const r = await runCloudJob(() => undefined);
    expect(r).toMatchObject({ files: 1, matched: 1 });
    const [report] = await results.file('reports/latest.html').download();
    expect(report.toString()).toContain('OpenAI API');
    expect((await runCloudJob(() => undefined)).files).toBe(0);
  }, 60_000);
});
