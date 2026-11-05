import { parseOnpremLine, parseOnpremText } from '../onprem/parsers';
import { parseCloudLine } from '../cloud';

const NOW = new Date('2026-11-05T12:00:00Z');
const FW = '/SUBSCRIPTIONS/1111/RESOURCEGROUPS/NET/PROVIDERS/MICROSOFT.NETWORK/AZUREFIREWALLS/HUB-FW';
const AOAI = '/SUBSCRIPTIONS/1111/RESOURCEGROUPS/AI/PROVIDERS/MICROSOFT.COGNITIVESERVICES/ACCOUNTS/ACME-OPENAI-EUS';
const line = (o: object) => JSON.stringify(o);

describe('Azure', () => {
  it('reads Azure Firewall application rule logs (resource-specific)', () => {
    const o = parseOnpremLine(line({ time: '2026-11-05T09:00:00.1234567Z', resourceId: FW, category: 'AZFWApplicationRule', operationName: 'AZFWApplicationRule',
      properties: { Protocol: 'HTTPS', SourceIp: '10.1.0.4', SourcePort: 53210, DestinationPort: 443, Fqdn: 'api.openai.com', TargetUrl: '', Action: 'Allow' } }), NOW);
    expect(o).toEqual({ time: '2026-11-05T09:00:00.1234567Z', domain: 'api.openai.com', who: { type: 'ip', value: '10.1.0.4' }, source: 'azure_firewall' });
  });

  it('reads the legacy firewall sentence form', () => {
    const o = parseOnpremLine(line({ time: '2026-11-05T09:01:00Z', resourceId: FW, category: 'AzureFirewallApplicationRule', operationName: 'AzureFirewallApplicationRuleLog',
      properties: { msg: 'HTTPS request from 10.1.0.5:51234 to api.anthropic.com:443. Action: Allow. Rule Collection: ai. Rule: allow-ai' } }), NOW);
    expect(o).toMatchObject({ domain: 'api.anthropic.com', who: { type: 'ip', value: '10.1.0.5' }, source: 'azure_firewall' });
  });

  it('reads firewall DNS proxy logs in both forms', () => {
    expect(parseOnpremLine(line({ time: '2026-11-05T09:02:00Z', resourceId: FW, category: 'AZFWDnsQuery', properties: { SourceIp: '10.1.0.6', QueryName: 'generativelanguage.googleapis.com.', QueryType: 'A' } }), NOW))
      .toMatchObject({ domain: 'generativelanguage.googleapis.com', source: 'azure_dns' });
    expect(parseOnpremLine(line({ time: '2026-11-05T09:03:00Z', resourceId: FW, category: 'AzureFirewallDnsProxy', properties: { msg: ' DNS Request: 10.1.0.7:53745 - 46420 A IN claude.ai. udp 32 false 512 NOERROR qr,rd,ra 64 0.000s' } }), NOW))
      .toMatchObject({ domain: 'claude.ai', who: { type: 'ip', value: '10.1.0.7' }, source: 'azure_dns' });
  });

  it('reads DNS security policy query logs', () => {
    expect(parseOnpremLine(line({ time: '2026-11-05T09:04:00Z', resourceId: '/SUBSCRIPTIONS/1111/RESOURCEGROUPS/NET/PROVIDERS/MICROSOFT.NETWORK/DNSRESOLVERPOLICIES/P1', category: 'DnsResponse',
      properties: { QueryName: 'chatgpt.com.', SourceIpAddress: '10.2.0.9', QueryType: 'A', ResponseCode: 0 } }), NOW))
      .toMatchObject({ domain: 'chatgpt.com', who: { type: 'ip', value: '10.2.0.9' }, source: 'azure_dns' });
  });

  it('counts Azure OpenAI model calls by the signed-in person, the app, or the IP address', () => {
    const base = { time: '2026-11-05T09:05:00Z', resourceId: AOAI, category: 'RequestResponse', properties: { modelDeploymentName: 'gpt-4o', modelName: 'gpt-4o' } };
    expect(parseOnpremLine(line({ ...base, operationName: 'ChatCompletions_Create', identity: { claim: { upn: 'j.doe@acme.example', appid: 'x' } } }), NOW))
      .toEqual({ time: '2026-11-05T09:05:00Z', service: 'azure-openai', domain: 'acme-openai-eus.openai.azure.com', kind: 'cloud_ai', who: { type: 'user', value: 'j.doe@acme.example' }, source: 'azure_openai' });
    expect(parseOnpremLine(line({ ...base, operationName: 'Embeddings_Create', identity: { claim: { appid: '0f3c-app' } } }), NOW)?.who).toEqual({ type: 'role', value: 'app:0f3c-app' });
    expect(parseOnpremLine(line({ ...base, operationName: 'Completions_Create', callerIpAddress: '52.10.20.*' }), NOW)?.who).toEqual({ type: 'ip', value: '52.10.20.0' });
  });

  it('ignores management calls and unrelated categories', () => {
    expect(parseOnpremLine(line({ time: 't', resourceId: AOAI, category: 'RequestResponse', operationName: 'Deployments_List' }), NOW)).toBeNull();
    expect(parseOnpremLine(line({ time: 't', resourceId: AOAI, category: 'Audit', operationName: 'ChatCompletions_Create' }), NOW)).toBeNull();
    expect(parseOnpremLine(line({ time: 't', resourceId: FW, category: 'AZFWNetworkRule', properties: { SourceIp: '10.0.0.1', DestinationIp: '1.2.3.4' } }), NOW)).toBeNull();
  });

  it('reads the older {"records": [...]} files, laid out on one line or many', () => {
    const recs = [
      { time: '2026-11-05T10:00:00Z', resourceId: FW, category: 'AZFWApplicationRule', properties: { SourceIp: '10.1.1.1', Fqdn: 'api.openai.com' } },
      { time: '2026-11-05T10:01:00Z', resourceId: FW, category: 'AZFWApplicationRule', properties: { SourceIp: '10.1.1.2', Fqdn: 'www.bbc.co.uk' } },
    ];
    expect([...parseOnpremText(JSON.stringify({ records: recs }), NOW)].map((o) => o.domain)).toEqual(['api.openai.com', 'www.bbc.co.uk']);
    const multiLine = `{ "records": [\n${recs.map((r) => JSON.stringify(r)).join(',\n')}\n]}`;
    expect([...parseOnpremText(multiLine, NOW)]).toHaveLength(2);
    // Followed line by line (the on-premises container), the trailing commas are fine too.
    expect(parseCloudLine(`${JSON.stringify(recs[0])},`)?.domain).toBe('api.openai.com');
  });
});

describe('Google Cloud', () => {
  const entry = (logName: string, extra: object) => line({ logName: `projects/acme-prod/logs/${encodeURIComponent(logName)}`, timestamp: '2026-11-05T11:00:00.123Z', insertId: 'x', ...extra });

  it('reads Cloud DNS query logs, naming the VM when known', () => {
    expect(parseOnpremLine(entry('dns.googleapis.com/dns_queries', { resource: { type: 'dns_query', labels: {} },
      jsonPayload: { queryName: 'api.openai.com.', queryType: 'A', sourceIP: '10.128.0.5', vmInstanceName: 'billing-worker-1', responseCode: 'NOERROR' } }), NOW))
      .toEqual({ time: '2026-11-05T11:00:00.123Z', domain: 'api.openai.com', who: { type: 'host', value: 'billing-worker-1' }, source: 'gcp_dns' });
    expect(parseOnpremLine(entry('dns.googleapis.com/dns_queries', { resource: { type: 'dns_query' }, jsonPayload: { queryName: 'claude.ai.', sourceIP: '10.128.0.6' } }), NOW)?.who)
      .toEqual({ type: 'ip', value: '10.128.0.6' });
  });

  it('reads Secure Web Proxy logs', () => {
    expect(parseOnpremLine(entry('networkservices.googleapis.com/gateway_requests', { resource: { type: 'networkservices.googleapis.com/Gateway' },
      httpRequest: { requestUrl: 'https://api.anthropic.com/v1/messages', remoteIp: '10.10.0.4:52311', status: 200 } }), NOW))
      .toMatchObject({ domain: 'api.anthropic.com', who: { type: 'ip', value: '10.10.0.4' }, source: 'gcp_web_proxy' });
  });

  it('counts Vertex AI and Gemini API calls from audit logs, by service account or person', () => {
    const audit = (serviceName: string, methodName: string, email: string, location = 'us-central1') => entry('cloudaudit.googleapis.com/data_access', {
      resource: { type: 'audited_resource', labels: { service: serviceName, method: methodName, location } },
      protoPayload: { '@type': 'type.googleapis.com/google.cloud.audit.AuditLog', serviceName, methodName,
        authenticationInfo: { principalEmail: email }, requestMetadata: { callerIp: '10.0.0.9' } },
    });
    expect(parseOnpremLine(audit('aiplatform.googleapis.com', 'google.cloud.aiplatform.v1.PredictionService.GenerateContent', 'support-bot@acme-prod.iam.gserviceaccount.com'), NOW))
      .toEqual({ time: '2026-11-05T11:00:00.123Z', service: 'vertex-ai', domain: 'us-central1-aiplatform.googleapis.com', kind: 'cloud_ai',
        who: { type: 'role', value: 'support-bot@acme-prod.iam.gserviceaccount.com' }, source: 'gcp_audit' });
    expect(parseOnpremLine(audit('generativelanguage.googleapis.com', 'google.ai.generativelanguage.v1beta.GenerativeService.GenerateContent', 'm.chen@acme.example'), NOW))
      .toMatchObject({ service: 'gemini-api', who: { type: 'user', value: 'm.chen@acme.example' } });
    expect(parseOnpremLine(audit('aiplatform.googleapis.com', 'google.cloud.aiplatform.v1.PredictionService.Predict', '', 'global'), NOW))
      .toMatchObject({ domain: 'aiplatform.googleapis.com', who: { type: 'ip', value: '10.0.0.9' } });
  });

  it('ignores audit entries that don’t run a model', () => {
    const e = entry('cloudaudit.googleapis.com/activity', { resource: { type: 'audited_resource' },
      protoPayload: { serviceName: 'aiplatform.googleapis.com', methodName: 'google.cloud.aiplatform.v1.EndpointService.ListEndpoints', authenticationInfo: { principalEmail: 'x@acme.example' } } });
    expect(parseOnpremLine(e, NOW)).toBeNull();
    const count = entry('cloudaudit.googleapis.com/data_access', { resource: { type: 'audited_resource' },
      protoPayload: { serviceName: 'aiplatform.googleapis.com', methodName: 'google.cloud.aiplatform.v1.PredictionService.CountTokens' } });
    expect(parseOnpremLine(count, NOW)).toBeNull();
  });

  it('ignores other log entries and plain JSON', () => {
    expect(parseOnpremLine(entry('compute.googleapis.com/firewall', { resource: { type: 'gce_subnetwork' }, jsonPayload: { connection: { dest_ip: '1.2.3.4' } } }), NOW)).toBeNull();
    expect(parseCloudLine('{"logName":"not a path","timestamp":"t"}')).toBeUndefined();
  });
});
