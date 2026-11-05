import { Observation } from '../core/sightings';
import { serviceForAppName } from '../core/catalog';

/**
 * Microsoft 365 unified audit log records (Office 365 Management Activity API, Microsoft Sentinel, or a
 * Purview audit search export, whose AuditData column holds the same JSON).
 *
 *  - CopilotInteraction: someone used Microsoft 365 Copilot (in Word, Teams, Outlook, …).
 *  - AIAppInteraction / ConnectedAIAppInteraction: activity in other AI apps that Purview watches; the app is
 *    matched by name against the catalog.
 */

const COPILOT = new Set(['CopilotInteraction']);
const AI_APP = new Set(['AIAppInteraction', 'ConnectedAIAppInteraction']);

export const isM365Record = (r: any) => !!r && typeof r === 'object' && typeof r.Operation === 'string' && typeof r.CreationTime === 'string' && ('Workload' in r || 'RecordType' in r);

/** M365 times have no zone; they are UTC. */
const utc = (t: string) => (/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t}Z`);

export function parseM365Record(r: any): Observation | null {
  if (!isM365Record(r)) return null;
  const who = typeof r.UserId === 'string' && r.UserId.includes('@')
    ? { type: 'user' as const, value: r.UserId }
    : { type: 'ip' as const, value: String(r.ClientIP ?? 'unknown') };
  if (COPILOT.has(r.Operation)) {
    return { time: utc(r.CreationTime), service: 'm365-copilot', kind: 'browser', who, source: 'm365_audit' };
  }
  if (AI_APP.has(r.Operation)) {
    const d = r.CopilotEventData ?? r.AIAppEventData ?? {};
    const name = String(d.AppIdentity?.DisplayName ?? d.AppIdentity ?? d.AppName ?? d.AppHost ?? r.AppName ?? '');
    const service = serviceForAppName(name);
    if (!service) return null;
    return { time: utc(r.CreationTime), service: service.id, kind: 'browser', who, source: 'm365_audit' };
  }
  return null;
}
