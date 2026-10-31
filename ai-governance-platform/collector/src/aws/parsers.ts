import { Actor, Observation } from '../core/sightings';

/** Read JSON lines, skipping blanks and lines that aren't JSON (headers, truncated writes). */
function* jsonLines(text: string): Generator<any> {
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l || l[0] !== '{') continue;
    try { yield JSON.parse(l); } catch { /* skip */ }
  }
}

/**
 * Route 53 Resolver query logs (S3 or CloudWatch delivery): one JSON object per line with `query_name`,
 * `query_timestamp`, `srcaddr` and, for lookups from EC2, `srcids.instance`.
 */
export function* parseResolverDns(text: string): Generator<Observation> {
  for (const r of jsonLines(text)) {
    if (typeof r.query_name !== 'string' || !r.query_timestamp) continue;
    const who: Actor = r.srcids?.instance ? { type: 'host', value: r.srcids.instance } : { type: 'ip', value: String(r.srcaddr ?? 'unknown') };
    yield { time: r.query_timestamp, domain: r.query_name, who, source: 'aws_dns' };
  }
}

/**
 * AWS Network Firewall logs (Suricata EVE JSON wrapped by the firewall). TLS and alert events carry the
 * server name (`tls.sni`); HTTP events carry `http.hostname`. Flow-only events have no name and are skipped.
 */
export function* parseNetworkFirewall(text: string): Generator<Observation> {
  for (const r of jsonLines(text)) {
    const e = r.event;
    if (!e) continue;
    const domain = e.tls?.sni ?? e.http?.hostname;
    if (typeof domain !== 'string' || !domain) continue;
    const epoch = Number(r.event_timestamp);
    const time = Number.isFinite(epoch) && epoch > 0 ? epoch * 1000 : String(e.timestamp ?? '').replace(/(\.\d{3})\d*/, '$1').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    yield { time, domain, who: { type: 'ip', value: String(e.src_ip ?? 'unknown') }, source: 'aws_firewall' };
  }
}

const BEDROCK_CALLS = new Set([
  'InvokeModel', 'InvokeModelWithResponseStream', 'Converse', 'ConverseStream',
  'InvokeAgent', 'InvokeInlineAgent', 'RetrieveAndGenerate', 'RetrieveAndGenerateStream', 'StartAsyncInvoke',
]);
const SAGEMAKER_CALLS = new Set(['InvokeEndpoint', 'InvokeEndpointAsync', 'InvokeEndpointWithResponseStream']);

/**
 * Who made a CloudTrail call. Roles stay readable (they name workloads); people (IAM users, and the
 * session names of IAM Identity Center sign-ins, which are usually emails) become pseudonyms later.
 */
export function cloudTrailActor(id: any): Actor {
  if (!id) return { type: 'role', value: 'unknown' };
  if (id.type === 'IAMUser') return { type: 'user', value: String(id.userName ?? id.arn ?? 'unknown') };
  if (id.type === 'Root') return { type: 'role', value: 'root' };
  if (id.type === 'AssumedRole') {
    const role = String(id.sessionContext?.sessionIssuer?.userName ?? String(id.arn ?? '').split('/')[1] ?? 'unknown');
    const session = String(id.arn ?? '').split('/')[2];
    if (role.startsWith('AWSReservedSSO_') && session) return { type: 'user', value: session };
    return { type: 'role', value: role };
  }
  if (id.type === 'AWSService') return { type: 'role', value: `service:${id.invokedBy ?? 'aws'}` };
  return { type: 'role', value: String(id.arn ?? id.principalId ?? 'unknown') };
}

/** CloudTrail log files: `{"Records":[…]}`. Counts calls that run a model; listing and setup calls are ignored. */
export function* parseCloudTrail(text: string): Generator<Observation> {
  let doc: any;
  try { doc = JSON.parse(text); } catch { return; }
  for (const r of doc?.Records ?? []) {
    let service: string | undefined;
    if (r.eventSource === 'bedrock.amazonaws.com' && BEDROCK_CALLS.has(r.eventName)) service = 'aws-bedrock';
    else if ((r.eventSource === 'sagemaker.amazonaws.com' || r.eventSource === 'runtime.sagemaker.amazonaws.com') && SAGEMAKER_CALLS.has(r.eventName)) service = 'aws-sagemaker';
    if (!service || !r.eventTime) continue;
    const region = /^[a-z0-9-]+$/.test(r.awsRegion ?? '') ? r.awsRegion : 'unknown';
    yield {
      time: r.eventTime,
      service,
      domain: service === 'aws-bedrock' ? `bedrock-runtime.${region}.amazonaws.com` : `runtime.sagemaker.${region}.amazonaws.com`,
      kind: 'cloud_ai',
      who: cloudTrailActor(r.userIdentity),
      source: 'aws_cloudtrail',
    };
  }
}

export type AwsSource = 'aws_dns' | 'aws_firewall' | 'aws_cloudtrail';

/** Which log a file is, from the S3 key AWS uses for each, or failing that from its content. */
export function detectSource(key: string, sample: string): AwsSource | null {
  if (/\/vpcdnsquerylogs\//.test(key)) return 'aws_dns';
  if (/\/network-firewall\//.test(key)) return 'aws_firewall';
  if (/\/CloudTrail\//.test(key)) return 'aws_cloudtrail';
  const head = sample.slice(0, 2000);
  if (/^\s*\{\s*"Records"\s*:/.test(head)) return 'aws_cloudtrail';
  if (head.includes('"query_name"')) return 'aws_dns';
  if (head.includes('"firewall_name"')) return 'aws_firewall';
  return null;
}

export function parse(source: AwsSource, text: string): Iterable<Observation> {
  if (source === 'aws_dns') return parseResolverDns(text);
  if (source === 'aws_firewall') return parseNetworkFirewall(text);
  return parseCloudTrail(text);
}
