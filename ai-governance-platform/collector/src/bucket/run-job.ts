import { Store } from '../core/store';
import { runBucketJob } from './job';
import { LogBucket } from './types';

const env = (k: string, d = '') => process.env[k] ?? d;
const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

/**
 * The in-cloud collector, configured by environment variables (set by the deployment template):
 *
 *   CLOUD=azure  LOG_ACCOUNT_URL, LOG_CONTAINERS (comma-separated), RESULTS_ACCOUNT_URL, RESULTS_CONTAINER
 *                (or AZURE_STORAGE_CONNECTION_STRING for both, when testing against Azurite)
 *   CLOUD=gcp    LOG_BUCKETS (comma-separated), RESULTS_BUCKET   (GCS_API_ENDPOINT only for local testing)
 *   Common:      LOG_PREFIXES, IGNORE, GATEWAY, REPORT_DAYS (30), COMPANY, MAX_FILES (2000)
 */
export async function runCloudJob(log: (m: string) => void = console.log) {
  const cloud = env('CLOUD').toLowerCase();
  let buckets: LogBucket[];
  let store: Store;
  if (cloud === 'azure') {
    const { blobService, AzureLogContainer, AzureBlobStore } = await import('./azure');
    const conn = env('AZURE_STORAGE_CONNECTION_STRING') || undefined;
    const logs = blobService({ url: env('LOG_ACCOUNT_URL'), connectionString: conn });
    const results = blobService({ url: env('RESULTS_ACCOUNT_URL') || env('LOG_ACCOUNT_URL'), connectionString: conn });
    const containers = list(env('LOG_CONTAINERS'));
    if (!containers.length || !env('RESULTS_CONTAINER')) throw new Error('Set LOG_CONTAINERS and RESULTS_CONTAINER');
    buckets = containers.map((c) => new AzureLogContainer(logs, c));
    store = new AzureBlobStore(results, env('RESULTS_CONTAINER'));
  } else if (cloud === 'gcp') {
    const { gcsClient, GcsLogBucket, GcsStore } = await import('./gcs');
    const storage = gcsClient(env('GCS_API_ENDPOINT') || undefined);
    const names = list(env('LOG_BUCKETS'));
    if (!names.length || !env('RESULTS_BUCKET')) throw new Error('Set LOG_BUCKETS and RESULTS_BUCKET');
    buckets = names.map((b) => new GcsLogBucket(storage, b));
    store = new GcsStore(storage, env('RESULTS_BUCKET'));
  } else {
    throw new Error('Set CLOUD to azure or gcp');
  }
  return runBucketJob({
    buckets, store, log,
    prefixes: list(env('LOG_PREFIXES')),
    ignore: list(env('IGNORE')),
    gateway: list(env('GATEWAY')),
    reportDays: Number(env('REPORT_DAYS', '30')) || 30,
    company: env('COMPANY') || undefined,
    maxFiles: Number(env('MAX_FILES', '2000')) || 2000,
  });
}
