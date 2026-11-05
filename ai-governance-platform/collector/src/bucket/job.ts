import { Store } from '../core/store';
import { buildReport, decode, isoDay, processInput } from '../core/run';
import { parseOnpremText } from '../onprem/parsers';
import { LogBucket } from './types';

export interface BucketJobOptions {
  buckets: LogBucket[];
  /** Only read objects under these prefixes (per bucket); empty means everything. */
  prefixes?: string[];
  store: Store;
  ignore?: string[];
  reportDays?: number;
  company?: string;
  /** Stop after this many files in one run; the rest are read next time. */
  maxFiles?: number;
  now?: Date;
  log?: (msg: string) => void;
}

export interface BucketJobResult { files: number; skipped: number; lines: number; matched: number; pending: number; report: string }

type Seen = Record<string, { etag: string; at: string }>;
const SEEN_KEY = 'private/processed-objects.json';

/**
 * One run of the in-cloud collector (Azure Container Apps job, Cloud Run job): read log files that are new
 * or changed since the last run, keep AI matches, then rebuild the report. Safe to run again at any time:
 * a re-read file replaces its own results.
 */
export async function runBucketJob(o: BucketJobOptions): Promise<BucketJobResult> {
  const log = o.log ?? (() => undefined);
  const now = o.now ?? new Date();
  const seen: Seen = JSON.parse((await o.store.get(SEEN_KEY)) ?? '{}');
  const maxFiles = o.maxFiles ?? 2000;
  const result: BucketJobResult = { files: 0, skipped: 0, lines: 0, matched: 0, pending: 0, report: '' };

  for (const bucket of o.buckets) {
    for (const prefix of o.prefixes?.length ? o.prefixes : ['']) {
      for await (const obj of bucket.list(prefix)) {
        const id = `${bucket.url}/${obj.name}`;
        if (seen[id]?.etag === obj.etag) continue;
        if (result.files >= maxFiles) { result.pending++; continue; }
        const text = decode(await bucket.read(obj.name));
        const observations = [...parseOnpremText(text, now)];
        if (observations.length === 0 && !text.trim()) { result.skipped++; seen[id] = { etag: obj.etag, at: now.toISOString() }; continue; }
        const r = await processInput(o.store, id, observations, o.ignore ?? []);
        result.files++;
        result.lines += r.lines;
        result.matched += r.matched;
        seen[id] = { etag: obj.etag, at: now.toISOString() };
      }
    }
  }

  // Forget files older than the report window, so the list doesn't grow for ever.
  const days = Math.min(Math.max(o.reportDays ?? 30, 1), 90);
  const cutoff = new Date(now.getTime() - (days + 7) * 86_400_000).toISOString();
  for (const [k, v] of Object.entries(seen)) if (v.at < cutoff) delete seen[k];
  await o.store.put(SEEN_KEY, JSON.stringify(seen), 'application/json');

  const to = isoDay(now);
  const from = isoDay(new Date(now.getTime() - (days - 1) * 86_400_000));
  const { key } = await buildReport(o.store, { from, to, company: o.company, now });
  result.report = key;
  log(`Read ${result.files} files (${result.matched} AI matches); ${result.pending} left for next run. Report: ${key}`);
  return result;
}
