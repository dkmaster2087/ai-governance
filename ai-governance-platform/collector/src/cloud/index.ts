import { Observation } from '../core/sightings';
import { AzureSource, isAzureRecord, parseAzureRecord } from './azure';
import { GcpSource, isGcpEntry, parseGcpEntry } from './gcp';

export type CloudSource = AzureSource | GcpSource;

/**
 * One line holding an Azure diagnostic record or a Google Cloud log entry. Returns undefined when the line
 * isn't a cloud record at all (so other parsers can try), null when it is one but names no AI service.
 * Azure's older `{"records": [ … ]}` files put one record per line with a trailing comma; that is accepted.
 */
export function parseCloudLine(line: string): Observation | null | undefined {
  let l = line.trim();
  if (l.endsWith(',')) l = l.slice(0, -1);
  if (!l.startsWith('{') || !l.endsWith('}') || !(l.includes('"resourceId"') || l.includes('"logName"'))) return undefined;
  let rec: any;
  try { rec = JSON.parse(l); } catch { return undefined; }
  if (isGcpEntry(rec)) return parseGcpEntry(rec);
  if (isAzureRecord(rec)) return parseAzureRecord(rec);
  return undefined;
}

/** A whole Azure `{"records": [...]}` document, however it is laid out. Null if the text isn't one. */
export function parseAzureDocument(text: string): Observation[] | null {
  const head = text.trimStart().slice(0, 40);
  if (!/^\{\s*"records"\s*:/.test(head)) return null;
  let doc: any;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(doc?.records)) return null;
  return doc.records.map(parseAzureRecord).filter((o: Observation | null): o is Observation => !!o);
}

export { parseAzureRecord, parseGcpEntry };
