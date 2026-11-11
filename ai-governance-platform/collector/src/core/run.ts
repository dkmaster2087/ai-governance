import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { buildFindings, Findings, PathId, ShareHistoryEntry } from './findings';
import { renderReport } from './report';
import { Aggregator, mergeSightings, Observation } from './sightings';
import { loadNames, loadPseudonymizer, loadSightings, saveNames, saveSightings, Store } from './store';
import { buildLaptopMcp, isEndpointMcp, loadMcpRows, parseEndpointMcp, saveMcpRows } from '../endpoint/mcp';
import { classify, detectApiLog, isInventory, loadApiCalls, loadInventory, parseInventory, saveApiCalls, saveInventory } from '../apis/access-logs';

export interface ProcessResult { lines: number; matched: number; files: number; throughProbaline: number }

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
  gateway: string[] = [],
): Promise<ProcessResult> {
  const pseudonyms = await loadPseudonymizer(store);
  const agg = new Aggregator({ pseudonyms, ignore, gateway });
  for (const o of observations) agg.add(o);
  const batchId = createHash('sha256').update(inputName).digest('hex').slice(0, 24);
  const files = await saveSightings(store, batchId, agg.byDay());
  await saveNames(store, pseudonyms);
  return { lines: agg.seen, matched: agg.matched, files, throughProbaline: agg.throughProbaline };
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export { isEndpointMcp, isInventory, detectApiLog };

/** Keep Probaline's API list in the store: later access logs are matched against it. */
export async function processInventory(store: Store, text: string): Promise<number> {
  const inv = parseInventory(text);
  await saveInventory(store, inv);
  return inv.apis.length;
}

/**
 * One API access log (ALB, API Gateway, nginx, Envoy) into the store, if Probaline's API list is there.
 * Returns null when the file isn't an access log, or there's no list to match it against.
 */
export async function processApiLog(store: Store, inputName: string, text: string, gateway: string[] = []): Promise<{ lines: number; matched: number; throughProbaline: number } | null> {
  const parser = detectApiLog(text);
  if (!parser) return null;
  const inv = await loadInventory(store);
  if (!inv) return null;
  const requests = text.split('\n').map((l) => parser(l.trim())).filter((r): r is NonNullable<typeof r> => !!r);
  const { rows, seen, matched } = classify(requests, inv, { gateway });
  await saveApiCalls(store, inputName, rows);
  return { lines: seen, matched, throughProbaline: rows.filter((r) => r.via).reduce((a, r) => a + r.count, 0) };
}

/** One laptop MCP scan file (endpoint/mcp-scan.sh or .ps1 output) into the store. */
export async function processMcpScan(store: Store, inputName: string, text: string): Promise<{ servers: number; devices: number }> {
  const pseudonyms = await loadPseudonymizer(store);
  const rows = parseEndpointMcp(text, pseudonyms);
  await saveMcpRows(store, inputName, rows);
  await saveNames(store, pseudonyms);
  return { servers: rows.filter((r) => r.kind === 'server').length, devices: new Set(rows.map((r) => r.device)).size };
}

export const HISTORY_REPORTS = 6;

/** Shares through Probaline from earlier findings files in the store, oldest first. Files without paths are skipped. */
export async function loadShareHistory(store: Store, before: string): Promise<ShareHistoryEntry[]> {
  const keys = (await store.list('reports/findings-'))
    .filter((k) => /^reports\/findings-\d{4}-\d{2}-\d{2}\.json$/.test(k) && k.slice(17, 27) < before)
    .sort()
    .slice(-HISTORY_REPORTS);
  const out: ShareHistoryEntry[] = [];
  for (const k of keys) {
    try {
      const f = JSON.parse((await store.get(k)) ?? '{}') as Partial<Findings>;
      if (!Array.isArray(f.paths) || typeof f.to !== 'string') continue;
      const shares: Partial<Record<PathId, number>> = {};
      for (const p of f.paths) if (typeof p.share === 'number' && p.gatewaySeen) shares[p.id] = p.share;
      out.push({ to: f.to, shares });
    } catch { /* an unreadable earlier file doesn't stop the report */ }
  }
  return out;
}

/** Build the report for a period and write it to the store. */
export async function buildReport(
  store: Store,
  opts: { from: string; to: string; revealNames?: boolean; company?: string; now?: Date; companyDomains?: string[] },
): Promise<{ findings: Findings; key: string; html: string }> {
  const rows = mergeSightings(await loadSightings(store, opts.from, opts.to));
  const findings = buildFindings(rows, opts.from, opts.to, opts.now, buildLaptopMcp(await loadMcpRows(store, opts.from, opts.to), opts.companyDomains), await loadApiCalls(store, opts.from, opts.to));
  const history = await loadShareHistory(store, opts.to);
  if (history.length) findings.history = history;
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
