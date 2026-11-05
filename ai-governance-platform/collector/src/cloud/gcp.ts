import { Actor, Observation } from '../core/sightings';

/**
 * Google Cloud log entries, as a Cloud Logging sink writes them to a Cloud Storage bucket (one LogEntry per
 * line) or to Pub/Sub. Every entry has `logName`, `resource`, `timestamp` and one payload.
 *
 *  - Cloud DNS query logs (`dns.googleapis.com/dns_queries`): which VMs looked up AI services.
 *  - Secure Web Proxy logs (`networkservices.googleapis.com`): the URL each request went to.
 *  - Cloud Audit Logs, data access: calls to Vertex AI (`aiplatform.googleapis.com`) and the Gemini API
 *    (`generativelanguage.googleapis.com`) that run a model. Data access logs must be turned on for these.
 */

export type GcpSource = 'gcp_dns' | 'gcp_web_proxy' | 'gcp_audit';

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

export const isGcpEntry = (e: any) => !!e && typeof e === 'object' && typeof e.logName === 'string' && /^(projects|organizations|folders|billingAccounts)\//.test(e.logName);

function hostIn(value: string): string | undefined {
  const v = value.trim().replace(/\.$/, '').replace(/^[a-z]+:\/\//i, '').split(/[/:?#]/)[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? v.toLowerCase() : undefined;
}

/** Service accounts name workloads; any other principal is a person. */
function principal(email: string, ip: string): Actor {
  if (email.endsWith('.gserviceaccount.com')) return { type: 'role', value: email };
  if (email.includes('@')) return { type: 'user', value: email };
  return { type: 'ip', value: ip || 'unknown' };
}

function dns(e: any): Observation | null {
  const p = e.jsonPayload ?? {};
  const domain = hostIn(str(p.queryName));
  if (!domain) return null;
  const vm = str(p.vmInstanceName ?? p.vmInstanceId);
  const who: Actor = vm ? { type: 'host', value: vm } : { type: 'ip', value: str(p.sourceIP) || 'unknown' };
  return { time: e.timestamp, domain, who, source: 'gcp_dns' };
}

function webProxy(e: any): Observation | null {
  const url = str(e.httpRequest?.requestUrl);
  const domain = hostIn(url);
  if (!domain) return null;
  return { time: e.timestamp, domain, who: { type: 'ip', value: str(e.httpRequest?.remoteIp).replace(/:\d+$/, '') || 'unknown' }, source: 'gcp_web_proxy' };
}

/** Methods that run a model; reading model lists, endpoints or jobs isn't counted. */
const MODEL_CALL = /(GenerateContent|StreamGenerateContent|Predict|RawPredict|StreamRawPredict|ServerStreamingPredict|DirectPredict|ChatCompletions|CountTokens|EmbedContent|BatchEmbedContents|GenerateAnswer|ComputeTokens)$/;

function audit(e: any): Observation | null {
  const p = e.protoPayload ?? {};
  const service = str(p.serviceName);
  const method = str(p.methodName);
  if (!MODEL_CALL.test(method) || /CountTokens|ComputeTokens/.test(method)) return null;
  const email = str(p.authenticationInfo?.principalEmail);
  const ip = str(p.requestMetadata?.callerIp);
  if (service === 'aiplatform.googleapis.com') {
    const location = str(e.resource?.labels?.location ?? '').toLowerCase();
    const region = /^[a-z0-9-]+$/.test(location) && location !== 'global' ? location : '';
    return {
      time: e.timestamp, service: 'vertex-ai', domain: region ? `${region}-aiplatform.googleapis.com` : 'aiplatform.googleapis.com',
      kind: 'cloud_ai', who: principal(email, ip), source: 'gcp_audit',
    };
  }
  if (service === 'generativelanguage.googleapis.com') {
    return { time: e.timestamp, service: 'gemini-api', domain: 'generativelanguage.googleapis.com', kind: 'api', who: principal(email, ip), source: 'gcp_audit' };
  }
  return null;
}

/** One Google Cloud log entry, or null if it isn't one this collector reads. */
export function parseGcpEntry(e: any): Observation | null {
  if (!isGcpEntry(e) || !e.timestamp) return null;
  const log = decodeURIComponent(str(e.logName).split('/logs/')[1] ?? '');
  const type = str(e.resource?.type);
  if (log === 'dns.googleapis.com/dns_queries' || type === 'dns_query') return dns(e);
  if (log.startsWith('networkservices.googleapis.com') || type.startsWith('networkservices.googleapis.com')) return webProxy(e);
  if (log.startsWith('cloudaudit.googleapis.com') && e.protoPayload) return audit(e);
  return null;
}
