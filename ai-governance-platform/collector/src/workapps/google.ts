import { Observation } from '../core/sightings';
import { serviceForAppName } from '../core/catalog';

/**
 * Google Workspace activity from the Admin SDK Reports API (`admin#reports#activity`).
 *
 *  - token / authorize: someone let an app reach their Google data with OAuth ("ChatGPT wants to see your
 *    Drive"). The most useful signal here: company data flowing into an AI app.
 *  - saml / login_success: single sign-on to an app Google Workspace is the identity provider for.
 *  - Gemini in Workspace activity (application names containing "gemini").
 */

export const isWorkspaceActivity = (a: any) => !!a && typeof a === 'object' && a.kind === 'admin#reports#activity' && !!a.id?.time;

const param = (event: any, name: string): string | undefined => {
  const p = (event.parameters ?? []).find((x: any) => x.name === name);
  return p?.value ?? p?.multiValue?.join(' ');
};

export function parseWorkspaceActivity(a: any): Observation[] {
  if (!isWorkspaceActivity(a)) return [];
  const app = String(a.id.applicationName ?? '');
  const email = String(a.actor?.email ?? '');
  const who = email.includes('@') ? { type: 'user' as const, value: email } : { type: 'ip' as const, value: String(a.ipAddress ?? 'unknown') };
  const out: Observation[] = [];
  for (const e of a.events ?? []) {
    if (/gemini/i.test(app)) {
      out.push({ time: a.id.time, service: 'gemini-workspace', kind: 'browser', who, source: 'gws_gemini' });
      continue;
    }
    if (app === 'token' && e.name === 'authorize') {
      const service = serviceForAppName(param(e, 'app_name') ?? '');
      if (service) out.push({ time: a.id.time, service: service.id, kind: 'browser', who, source: 'gws_oauth' });
      continue;
    }
    if (app === 'saml' && e.name === 'login_success') {
      const service = serviceForAppName(param(e, 'application_name') ?? '');
      if (service) out.push({ time: a.id.time, service: service.id, kind: 'browser', who, source: 'gws_sso' });
    }
  }
  return out;
}
