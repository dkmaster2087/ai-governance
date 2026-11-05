import { Observation } from '../core/sightings';
import { isM365Record, parseM365Record } from './m365';
import { isWorkspaceActivity, parseWorkspaceActivity } from './google';
import { isOktaEvent, parseOktaEvent } from './okta';
import { isEntraAudit, isEntraSignIn, parseEntraAudit, parseEntraSignIn } from './entra';

export { parseEntraDiagnostic } from './entra';
export { idpColumns, parseIdpRecord } from './generic';
export { parseM365Record } from './m365';

export type WorkAppSource = 'm365_audit' | 'gws_gemini' | 'gws_oauth' | 'gws_sso' | 'okta_sso' | 'okta_consent' | 'entra_signin' | 'entra_consent' | 'idp_signin';

/**
 * One record from Microsoft 365, Google Workspace, Okta or Entra. Undefined when it isn't one of these at all
 * (other parsers then try); an empty list when it is but names no AI service.
 */
export function parseWorkAppRecord(r: any): Observation[] | undefined {
  if (isM365Record(r)) return [parseM365Record(r)].filter(Boolean) as Observation[];
  if (isWorkspaceActivity(r)) return parseWorkspaceActivity(r);
  if (isOktaEvent(r)) return [parseOktaEvent(r)].filter(Boolean) as Observation[];
  if (isEntraSignIn(r)) return [parseEntraSignIn(r)].filter(Boolean) as Observation[];
  if (isEntraAudit(r)) return [parseEntraAudit(r)].filter(Boolean) as Observation[];
  return undefined;
}

/**
 * A whole API response or export file: a JSON array (Okta, Management Activity API), or an object holding the
 * records under `value` (Microsoft Graph) or `items` (Google Reports API). Null if the text isn't one.
 */
export function parseWorkAppDocument(text: string): Observation[] | null {
  const head = text.trimStart();
  if (!head.startsWith('[') && !/^\{\s*"(value|items|@odata\.context|kind)"/.test(head.slice(0, 60))) return null;
  let doc: any;
  try { doc = JSON.parse(text); } catch { return null; }
  const records: unknown[] | undefined = Array.isArray(doc) ? doc : Array.isArray(doc?.value) ? doc.value : Array.isArray(doc?.items) ? doc.items : undefined;
  if (!records) return null;
  const out: Observation[] = [];
  let known = false;
  for (const r of records) {
    const o = parseWorkAppRecord(r);
    if (o !== undefined) { known = true; out.push(...o); }
  }
  return known ? out : null;
}
