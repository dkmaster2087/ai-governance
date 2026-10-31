import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { buildFindings, Findings } from './findings';
import { renderReport } from './report';
import { Aggregator, mergeSightings, Observation } from './sightings';
import { loadNames, loadPseudonymizer, loadSightings, saveNames, saveSightings, Store } from './store';

export interface ProcessResult { lines: number; matched: number; files: number }

/** Decompress if gzip, then decode. Log deliveries are usually .gz. */
export function decode(body: Buffer): string {
  const gz = body.length > 2 && body[0] === 0x1f && body[1] === 0x8b;
  return (gz ? gunzipSync(body) : body).toString('utf8');
}

/**
 * Turn one input (a log file) into sightings in the store. The input's name decides the batch, so the
 * same file processed twice replaces its results instead of counting twice.
 */
export async function processInput(
  store: Store,
  inputName: string,
  observations: Iterable<Observation>,
  ignore: string[] = [],
): Promise<ProcessResult> {
  const pseudonyms = await loadPseudonymizer(store);
  const agg = new Aggregator({ pseudonyms, ignore });
  for (const o of observations) agg.add(o);
  const batchId = createHash('sha256').update(inputName).digest('hex').slice(0, 24);
  const files = await saveSightings(store, batchId, agg.byDay());
  await saveNames(store, pseudonyms);
  return { lines: agg.seen, matched: agg.matched, files };
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Build the report for a period and write it to the store. */
export async function buildReport(
  store: Store,
  opts: { from: string; to: string; revealNames?: boolean; company?: string; now?: Date },
): Promise<{ findings: Findings; key: string; html: string }> {
  const rows = mergeSightings(await loadSightings(store, opts.from, opts.to));
  const findings = buildFindings(rows, opts.from, opts.to, opts.now);
  const names = opts.revealNames ? await loadNames(store) : undefined;
  const html = renderReport(findings, { names, company: opts.company });
  // The copy with names goes in private/, next to the key, so it isn't mistaken for the shareable one.
  const key = opts.revealNames ? `private/report-with-names-${opts.to}.html` : `reports/report-${opts.to}.html`;
  await store.put(key, html, 'text/html; charset=utf-8');
  if (!opts.revealNames) {
    await store.put('reports/latest.html', html, 'text/html; charset=utf-8');
    await store.put(`reports/findings-${opts.to}.json`, JSON.stringify(findings, null, 2), 'application/json');
  }
  return { findings, key, html };
}
