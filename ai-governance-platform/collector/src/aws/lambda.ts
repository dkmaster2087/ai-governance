import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { buildReport, decode, isoDay, processInput } from '../core/run';
import { detectSource, parse } from './parsers';
import { readObject, S3Store } from './s3-store';

/**
 * The AWS collector. Runs in the customer's account with read-only access to their log buckets and
 * write access to its own results bucket. Three kinds of event:
 *  - a new log file (EventBridge "Object Created", or a classic S3 notification): read it, keep AI matches
 *  - the daily schedule, or {"action":"report"}: rebuild the report
 *  - {"action":"backfill","days":30}: read log files already in the buckets (safe to run again)
 */

// S3_FORCE_PATH_STYLE is for local testing against LocalStack.
const s3 = new S3Client({ forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true' });
const env = (k: string, d = '') => process.env[k] ?? d;
const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

function config() {
  const results = env('RESULTS_BUCKET');
  if (!results) throw new Error('RESULTS_BUCKET is not set');
  return {
    results,
    logBuckets: new Set(list(env('LOG_BUCKETS'))),
    ignore: list(env('IGNORE')),
    reportDays: Math.min(Math.max(Number(env('REPORT_DAYS', '30')) || 30, 1), 90),
    company: env('COMPANY') || undefined,
  };
}

type Ctx = { getRemainingTimeInMillis?: () => number } | undefined;

async function processObject(bucket: string, key: string) {
  const cfg = config();
  if (!cfg.logBuckets.has(bucket)) return { key, skipped: 'bucket not configured' };
  const text = decode(await readObject(s3, bucket, key));
  const source = detectSource(key, text);
  if (!source) return { key, skipped: 'not a log this collector reads' };
  const result = await processInput(new S3Store(s3, cfg.results), `s3://${bucket}/${key}`, parse(source, text), cfg.ignore);
  return { key, source, ...result };
}

async function report(now = new Date()) {
  const cfg = config();
  const to = isoDay(now);
  const from = isoDay(new Date(now.getTime() - (cfg.reportDays - 1) * 86_400_000));
  const { findings, key } = await buildReport(new S3Store(s3, cfg.results), { from, to, company: cfg.company, now });
  return { report: `s3://${cfg.results}/${key}`, services: findings.totals.services, recommendations: findings.recommendations.length };
}

async function backfill(days: number, ctx: Ctx) {
  const cfg = config();
  const since = Date.now() - Math.min(Math.max(days, 1), 90) * 86_400_000;
  let processed = 0;
  let matched = 0;
  for (const bucket of cfg.logBuckets) {
    let token: string | undefined;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'AWSLogs/', ContinuationToken: token }));
      for (const o of page.Contents ?? []) {
        if (!o.Key || (o.LastModified && o.LastModified.getTime() < since)) continue;
        if (ctx?.getRemainingTimeInMillis && ctx.getRemainingTimeInMillis() < 60_000) {
          // Out of time: results so far are saved, and running again skips nothing but repeats nothing.
          return { processed, matched, finished: false, note: 'Ran out of time; run the backfill again to continue.' };
        }
        const r = await processObject(bucket, o.Key);
        if ('matched' in r) { processed++; matched += r.matched ?? 0; }
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
  return { processed, matched, finished: true, ...(await report()) };
}

export async function handler(event: any, context?: Ctx) {
  if (event?.action === 'report' || event?.['detail-type'] === 'Scheduled Event') return report();
  if (event?.action === 'backfill') return backfill(Number(event.days) || 30, context);

  if (event?.source === 'aws.s3' && event.detail?.bucket?.name && event.detail?.object?.key) {
    return processObject(event.detail.bucket.name, event.detail.object.key);
  }
  if (Array.isArray(event?.Records)) {
    const out = [];
    for (const r of event.Records) {
      if (!r.s3) continue;
      out.push(await processObject(r.s3.bucket.name, decodeURIComponent(String(r.s3.object.key).replace(/\+/g, ' '))));
    }
    return out;
  }
  return { skipped: 'unrecognized event' };
}
