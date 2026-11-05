import { Observation } from '../core/sightings';
import { serviceForAppName } from '../core/catalog';

/**
 * Microsoft Entra ID.
 *
 *  - Sign-in logs: from Microsoft Graph (`auditLogs/signIns`) or a diagnostic setting (category SignInLogs or
 *    NonInteractiveUserSignInLogs, written like other Azure records). Successful sign-ins to AI apps.
 *  - Audit logs, "Consent to application": someone granted an AI app access to company data.
 */

/** A Graph sign-in, or the `properties` of a diagnostic SignInLogs record. */
export const isEntraSignIn = (s: any) => !!s && typeof s === 'object' && typeof s.appDisplayName === 'string' && typeof s.createdDateTime === 'string';

export function parseEntraSignIn(s: any): Observation | null {
  if (!isEntraSignIn(s)) return null;
  if (s.status && Number(s.status.errorCode ?? 0) !== 0) return null;
  const service = serviceForAppName(s.appDisplayName);
  if (!service) return null;
  const upn = String(s.userPrincipalName ?? '');
  const who = upn.includes('@') ? { type: 'user' as const, value: upn } : { type: 'ip' as const, value: String(s.ipAddress ?? 'unknown') };
  return { time: s.createdDateTime, service: service.id, kind: 'browser', who, source: 'entra_signin' };
}

/** A Graph directory audit, or the `properties` of a diagnostic AuditLogs record. */
export const isEntraAudit = (a: any) => !!a && typeof a === 'object' && typeof a.activityDisplayName === 'string' && typeof a.activityDateTime === 'string';

export function parseEntraAudit(a: any): Observation | null {
  if (!isEntraAudit(a) || a.activityDisplayName !== 'Consent to application' || (a.result && a.result !== 'success')) return null;
  const target = (a.targetResources ?? []).find((t: any) => t?.type === 'ServicePrincipal') ?? a.targetResources?.[0];
  const service = serviceForAppName(String(target?.displayName ?? ''));
  if (!service) return null;
  const upn = String(a.initiatedBy?.user?.userPrincipalName ?? '');
  const who = upn.includes('@') ? { type: 'user' as const, value: upn } : { type: 'role' as const, value: String(a.initiatedBy?.app?.displayName ?? 'unknown') };
  return { time: a.activityDateTime, service: service.id, kind: 'browser', who, source: 'entra_consent' };
}

/** An Entra record exported by a diagnostic setting (resourceId under /tenants/…/providers/Microsoft.aadiam). */
export function parseEntraDiagnostic(r: any): Observation | null | undefined {
  const category = String(r?.category ?? '');
  if (/SignInLogs$/.test(category) && !/ServicePrincipal|ManagedIdentity/.test(category)) {
    return parseEntraSignIn({ createdDateTime: r.time, ...r.properties });
  }
  if (category === 'AuditLogs') return parseEntraAudit({ activityDateTime: r.time, ...r.properties });
  return undefined;
}
