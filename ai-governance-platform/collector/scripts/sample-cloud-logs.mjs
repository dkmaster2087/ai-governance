#!/usr/bin/env node
// Made-up Azure and Google Cloud logs, laid out the way each cloud writes them to storage. Nothing here is real.
//  azure/<container>/resourceId=/SUBSCRIPTIONS/…/y=YYYY/m=MM/d=DD/h=HH/m=00/PT1H.json   (diagnostic settings → storage)
//  gcp/<log id>/YYYY/MM/DD/HH:00:00_HH:59:59_S0.json                                     (Cloud Logging sink → Cloud Storage)
// Usage: node collector/scripts/sample-cloud-logs.mjs <out-dir> [days=7]
import fs from 'node:fs';
import path from 'node:path';

const [out, d] = process.argv.slice(2);
if (!out) { console.error('usage: sample-cloud-logs.mjs <out-dir> [days]'); process.exit(1); }
const days = Number(d || 7);
let seed = 23;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const pad = (n) => String(n).padStart(2, '0');

const ai = ['api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'chatgpt.com', 'claude.ai', 'api.mistral.ai'];
const other = ['login.microsoftonline.com', 'github.com', 'pypi.org', 'registry.npmjs.org', 'storage.googleapis.com'];
const host = () => (rand() < 0.5 ? pick(ai) : pick(other));
const people = ['j.doe', 'm.chen', 'priya', 'sam', 'fatima'].map((u) => `${u}@acme.example`);
const FW = '/SUBSCRIPTIONS/0000-1111/RESOURCEGROUPS/NET/PROVIDERS/MICROSOFT.NETWORK/AZUREFIREWALLS/HUB-FW';
const AOAI = '/SUBSCRIPTIONS/0000-1111/RESOURCEGROUPS/AI/PROVIDERS/MICROSOFT.COGNITIVESERVICES/ACCOUNTS/ACME-OPENAI-EUS';

const files = new Map();
const add = (file, record) => { if (!files.has(file)) files.set(file, []); files.get(file).push(JSON.stringify(record)); };
const azurePath = (container, resource, t) => path.join('azure', container, `resourceId=${resource}`, `y=${t.getUTCFullYear()}`, `m=${pad(t.getUTCMonth() + 1)}`, `d=${pad(t.getUTCDate())}`, `h=${pad(t.getUTCHours())}`, 'm=00', 'PT1H.json');
const gcpPath = (logId, t) => path.join('gcp', logId, String(t.getUTCFullYear()), pad(t.getUTCMonth() + 1), pad(t.getUTCDate()), `${pad(t.getUTCHours())}:00:00_${pad(t.getUTCHours())}:59:59_S0.json`);
const gcpEntry = (logId, t, extra) => ({ logName: `projects/acme-prod/logs/${encodeURIComponent(logId)}`, timestamp: t.toISOString(), receiveTimestamp: t.toISOString(), insertId: Math.floor(rand() * 1e12).toString(36), ...extra });

const end = Date.now();
for (let i = 0; i < days * 400; i++) {
  const t = new Date(end - rand() * days * 86400000);
  t.setUTCMinutes(Math.floor(rand() * 60));
  const r = rand();
  if (r < 0.25) {
    add(azurePath('insights-logs-azfwapplicationrule', FW, t), { time: t.toISOString(), resourceId: FW, category: 'AZFWApplicationRule', operationName: 'AZFWApplicationRule',
      properties: { Protocol: 'HTTPS', SourceIp: `10.1.${Math.floor(rand() * 4)}.${4 + Math.floor(rand() * 50)}`, SourcePort: 40000 + Math.floor(rand() * 20000), DestinationPort: 443, Fqdn: host(), TargetUrl: '', Action: 'Allow' } });
  } else if (r < 0.4) {
    add(azurePath('insights-logs-azfwdnsquery', FW, t), { time: t.toISOString(), resourceId: FW, category: 'AZFWDnsQuery', operationName: 'AZFWDnsQuery',
      properties: { SourceIp: `10.1.0.${4 + Math.floor(rand() * 50)}`, QueryName: `${host()}.`, QueryType: 'A' } });
  } else if (r < 0.55) {
    const signedIn = rand() < 0.5;
    add(azurePath('insights-logs-requestresponse', AOAI, t), { time: t.toISOString(), resourceId: AOAI, category: 'RequestResponse',
      operationName: pick(['ChatCompletions_Create', 'ChatCompletions_Create', 'Embeddings_Create', 'Deployments_List']),
      callerIpAddress: `52.160.${Math.floor(rand() * 200)}.*`,
      ...(signedIn ? { identity: { claim: rand() < 0.6 ? { upn: pick(people) } : { appid: 'a1b2c3-support-bot' } } } : {}),
      properties: { modelDeploymentName: 'gpt-4o', modelName: 'gpt-4o', responseTime: Math.floor(rand() * 3000) } });
  } else if (r < 0.75) {
    add(gcpPath('dns.googleapis.com/dns_queries', t), gcpEntry('dns.googleapis.com/dns_queries', t, { resource: { type: 'dns_query', labels: { project_id: 'acme-prod' } },
      jsonPayload: { queryName: `${host()}.`, queryType: 'A', sourceIP: `10.128.0.${2 + Math.floor(rand() * 60)}`, vmInstanceName: rand() < 0.7 ? pick(['billing-worker-1', 'etl-runner', 'support-bot-vm']) : undefined, responseCode: 'NOERROR' } }));
  } else if (r < 0.85) {
    add(gcpPath('networkservices.googleapis.com/gateway_requests', t), gcpEntry('networkservices.googleapis.com/gateway_requests', t, { resource: { type: 'networkservices.googleapis.com/Gateway' },
      httpRequest: { requestUrl: `https://${host()}/v1/`, remoteIp: `10.10.0.${2 + Math.floor(rand() * 40)}:${40000 + Math.floor(rand() * 20000)}`, status: 200 } }));
  } else {
    const vertex = rand() < 0.7;
    const serviceName = vertex ? 'aiplatform.googleapis.com' : 'generativelanguage.googleapis.com';
    const methodName = vertex ? pick(['google.cloud.aiplatform.v1.PredictionService.GenerateContent', 'google.cloud.aiplatform.v1.PredictionService.Predict', 'google.cloud.aiplatform.v1.EndpointService.ListEndpoints'])
      : 'google.ai.generativelanguage.v1beta.GenerativeService.GenerateContent';
    add(gcpPath('cloudaudit.googleapis.com/data_access', t), gcpEntry('cloudaudit.googleapis.com/data_access', t, { resource: { type: 'audited_resource', labels: { service: serviceName, method: methodName, location: 'us-central1' } },
      protoPayload: { '@type': 'type.googleapis.com/google.cloud.audit.AuditLog', serviceName, methodName,
        authenticationInfo: { principalEmail: rand() < 0.6 ? pick(['support-bot@acme-prod.iam.gserviceaccount.com', 'etl@acme-prod.iam.gserviceaccount.com']) : pick(people) },
        requestMetadata: { callerIp: `10.128.0.${2 + Math.floor(rand() * 60)}` } } }));
  }
}

let n = 0;
for (const [file, lines] of files) {
  fs.mkdirSync(path.join(out, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(out, file), lines.join('\n') + '\n');
  n += lines.length;
}
console.log(`Wrote ${n} records in ${files.size} files to ${out}`);
