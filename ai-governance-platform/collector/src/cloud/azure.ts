import { Actor, Observation } from '../core/sightings';

/**
 * Azure diagnostic logs, as Azure Monitor writes them to a storage account (one JSON record per line, or the
 * older `{"records": [...]}` form) or streams them to an event hub. Every record has `time`, `resourceId`,
 * `category` and `properties`.
 *
 *  - Azure Firewall: application rule logs (the FQDN each workload reached) and DNS proxy logs, in both the
 *    resource-specific form (AZFWApplicationRule, AZFWDnsQuery) and the legacy form (a `msg` sentence).
 *  - DNS security policy query logs (QueryName, SourceIpAddress).
 *  - Azure OpenAI / AI Foundry request logs (Cognitive Services, category RequestResponse): model calls.
 */

export type AzureSource = 'azure_firewall' | 'azure_dns' | 'azure_openai';

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

/** A record looks like Azure's when it carries a resource ID and a category. */
export const isAzureRecord = (r: any) => !!r && typeof r === 'object' && typeof (r.resourceId ?? r.ResourceId) === 'string' && typeof (r.category ?? r.Category) === 'string';

function hostIn(value: string): string | undefined {
  const v = value.trim().replace(/\.$/, '').replace(/^[a-z]+:\/\//i, '').split(/[/:?#]/)[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? v.toLowerCase() : undefined;
}

function firewall(r: any, category: string): Observation | null {
  const p = r.properties ?? {};
  const time = r.time ?? r.TimeGenerated;
  if (category === 'AZFWApplicationRule' || category === 'AZFWApplicationRuleAggregation') {
    const domain = hostIn(str(p.Fqdn)) ?? hostIn(str(p.TargetUrl));
    if (!domain) return null;
    return { time, domain, who: { type: 'ip', value: str(p.SourceIp) || 'unknown' }, source: 'azure_firewall' };
  }
  if (category === 'AZFWDnsQuery') {
    const domain = hostIn(str(p.QueryName));
    if (!domain) return null;
    return { time, domain, who: { type: 'ip', value: str(p.SourceIp) || 'unknown' }, source: 'azure_dns' };
  }
  // Legacy: "HTTPS request from 10.1.0.4:53210 to api.openai.com:443. Action: Allow. …"
  const msg = str(p.msg);
  if (category === 'AzureFirewallApplicationRule') {
    const m = /request from ([0-9a-fA-F.:]+?):\d+ to ([^\s:]+):\d+/.exec(msg);
    const domain = m && hostIn(m[2]);
    if (!domain) return null;
    return { time, domain, who: { type: 'ip', value: m![1] }, source: 'azure_firewall' };
  }
  // Legacy DNS proxy: "DNS Request: 10.1.0.4:53745 - 46420 A IN api.openai.com. udp 32 false 512 NOERROR …"
  if (category === 'AzureFirewallDnsProxy') {
    const m = /DNS Request: ([0-9a-fA-F.:]+?):\d+ - \d+ \S+ IN (\S+)/.exec(msg);
    const domain = m && hostIn(m[2]);
    if (!domain) return null;
    return { time, domain, who: { type: 'ip', value: m![1] }, source: 'azure_dns' };
  }
  return null;
}

/** DNS security policy (and similar) query logs: a query name and the asking address. */
function dnsQuery(r: any): Observation | null {
  const p = r.properties ?? {};
  const domain = hostIn(str(p.QueryName ?? p.queryName));
  if (!domain) return null;
  const ip = str(p.SourceIpAddress ?? p.SourceIp ?? p.sourceIpAddress);
  return { time: r.time, domain, who: { type: 'ip', value: ip || 'unknown' }, source: 'azure_dns' };
}

/** Calls that run a model; listing deployments and other management calls are ignored. */
const MODEL_CALL = /(chat|completion|embedding|response|image|audio|transcri|speech|realtime|assistant|run|generat|infer)/i;

/**
 * Who called Azure OpenAI. Microsoft Entra sign-ins carry a user principal name (a person) or an app ID
 * (a workload); key-based calls carry neither, so the caller's IP address is used.
 */
function openAiActor(r: any): Actor {
  const claims = r.identity?.claim ?? r.identity?.claims ?? {};
  const upn = str(claims.upn ?? claims['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn'] ?? claims.unique_name);
  if (upn && upn.includes('@')) return { type: 'user', value: upn };
  const app = str(claims.appid ?? claims.azp ?? r.properties?.appId);
  if (app) return { type: 'role', value: `app:${app}` };
  const ip = str(r.callerIpAddress ?? r.CallerIPAddress);
  return { type: 'ip', value: ip.replace(/\*+$/, '0') || 'unknown' };
}

function openAi(r: any): Observation | null {
  const op = str(r.operationName ?? r.OperationName);
  if (!MODEL_CALL.test(op)) return null;
  const account = /\/PROVIDERS\/MICROSOFT\.COGNITIVESERVICES\/ACCOUNTS\/([^/]+)/i.exec(str(r.resourceId))?.[1]?.toLowerCase();
  if (!account) return null;
  return {
    time: r.time,
    service: 'azure-openai',
    domain: `${account}.openai.azure.com`,
    kind: 'cloud_ai',
    who: openAiActor(r),
    source: 'azure_openai',
  };
}

/** One Azure diagnostic record, or null if it isn't one this collector reads. */
export function parseAzureRecord(r: any): Observation | null {
  if (!isAzureRecord(r) || !(r.time ?? r.TimeGenerated)) return null;
  const category = str(r.category ?? r.Category);
  if (/^(AZFW|AzureFirewall)/.test(category)) return firewall(r, category);
  if (/MICROSOFT\.COGNITIVESERVICES/i.test(str(r.resourceId)) && /^RequestResponse$/i.test(category)) return openAi(r);
  if (/dns/i.test(category)) return dnsQuery(r);
  return null;
}
