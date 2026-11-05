import { Observation } from '../core/sightings';
import { serviceForAppName } from '../core/catalog';

/**
 * Okta System Log events (the System Log API, or a SIEM export of it). Single sign-on and OAuth consent to
 * apps that are AI services; failed attempts are skipped.
 */

export const isOktaEvent = (e: any) => !!e && typeof e === 'object' && typeof e.eventType === 'string' && typeof e.published === 'string' && Array.isArray(e.target);

const COUNTED = /^(user\.authentication\.sso|app\.oauth2\.as\.consent\.grant|app\.oauth2\.consent\.grant|user\.authentication\.auth_via_IDP)/;

export function parseOktaEvent(e: any): Observation | null {
  if (!isOktaEvent(e) || !COUNTED.test(e.eventType)) return null;
  if (e.outcome?.result && e.outcome.result !== 'SUCCESS') return null;
  const app = (e.target as any[]).find((t) => t?.type === 'AppInstance' || t?.type === 'PublicClientApp' || t?.type === 'AppUser');
  const service = serviceForAppName(String(app?.displayName ?? app?.alternateId ?? ''));
  if (!service) return null;
  const login = String(e.actor?.alternateId ?? '');
  const who = login.includes('@') ? { type: 'user' as const, value: login } : { type: 'ip' as const, value: String(e.client?.ipAddress ?? 'unknown') };
  return { time: e.published, service: service.id, kind: 'browser', who, source: e.eventType.startsWith('app.oauth2') ? 'okta_consent' : 'okta_sso' };
}
