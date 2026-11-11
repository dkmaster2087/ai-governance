import { AuditLog } from '@ai-governance/types';
import { buildEvidenceRecord, listEvidence } from '../reports/evidence';

const log = (over: Partial<AuditLog>): AuditLog => ({
  logId: 'l', requestId: 'req-1', tenantId: 'tenant_acme', userId: 'j.patel', appId: 'billing-api', eventType: 'request_allowed',
  provider: 'openai', modelId: 'gpt-4o', promptHash: 'abc', responseHash: 'def', policyDecision: 'allow', triggeredRules: [],
  piiDetected: false, piiTypes: [], inputTokens: 20, outputTokens: 10, estimatedCost: 0.001, latencyMs: 412,
  timestamp: '2026-10-27T10:00:00.000Z', metadata: {}, ...over,
});

describe('evidence record', () => {
  it('tells the story of a stopped request with its excerpt', () => {
    const r = buildEvidenceRecord(log({
      eventType: 'request_blocked', triggeredRules: ['r_kw'],
      metadata: { policyReason: 'Block confidential keywords', evidenceBefore: 'Summarise the ', evidenceHit: 'confidential', evidenceAfter: ' memo' },
    }), 365);
    expect(r.outcome).toBe('stopped');
    expect(r.headline).toBe('A billing-api prompt was stopped and never reached OpenAI.');
    expect(r.steps.map((s) => s.label)).toEqual(['Received', 'Stopped by a policy rule', 'Secrets', 'Not sent']);
    expect(r.excerpt).toEqual({ before: 'Summarise the ', hit: 'confidential', after: ' memo' });
    expect(r.usage).toBeUndefined();
    expect(r.proof.keptUntil).toBe('2027-10-27T10:00:00.000Z');
  });

  it('records cleaning and delivery for a cleaned request', () => {
    const r = buildEvidenceRecord(log({ piiDetected: true }), 90);
    expect(r.outcome).toBe('cleaned');
    expect(r.steps.map((s) => s.label)).toEqual(['Received', 'Policy rules passed', 'Secrets', 'Personal data removed', 'Delivered to OpenAI']);
    expect(r.steps[4].detail).toBe('gpt-4o answered in 412 ms using 30 tokens.');
  });

  it('says when the provider didn’t answer, after the prompt was cleaned and sent', () => {
    const r = buildEvidenceRecord(log({ piiDetected: true, inputTokens: 0, outputTokens: 0, responseHash: '', metadata: { providerError: 'Provider openai: quota exceeded' } }), 90);
    expect(r.outcome).toBe('cleaned');
    expect(r.headline).toBe('A billing-api prompt was cleaned of personal data, then sent to OpenAI. OpenAI didn’t answer.');
    expect(r.steps[4]).toEqual({ label: 'Sent to OpenAI, not answered', detail: 'OpenAI refused or failed: Provider openai: quota exceeded', kind: 'skipped' });
  });

  it('is explicit when a check was skipped because it was down', () => {
    const r = buildEvidenceRecord(log({ metadata: { governanceDegraded: 'policy_evaluation' } }), 90);
    expect(r.steps[1]).toMatchObject({ label: 'Policy rules skipped', kind: 'skipped' });
  });

  it('tells the story of a request stopped for a secret, without the secret', () => {
    const r = buildEvidenceRecord(log({
      eventType: 'request_blocked', triggeredRules: ['Secrets detection'],
      metadata: { check: 'secrets', secretsChecked: 'true', secretTypes: 'aws_access_key', policyReason: 'Contains an AWS access key', evidenceBefore: 'why does ', evidenceHit: '[AWS access key]', evidenceAfter: ' fail' },
    }), 365);
    expect(r.steps.map((s) => s.label)).toEqual(['Received', 'Policy rules passed', 'Stopped: secret in the prompt', 'Not sent']);
    expect(r.steps[2].detail).toBe('found aws access key. The secret itself was not recorded.');
    expect(r.excerpt?.hit).toBe('[AWS access key]');
  });

  it('records secrets removed before sending as cleaned', () => {
    const r = buildEvidenceRecord(log({ metadata: { secretsChecked: 'true', secretsRedacted: '2', secretTypes: 'github_token,password' } }), 90);
    expect(r.outcome).toBe('cleaned');
    expect(r.headline).toBe('A billing-api prompt was cleaned of secrets, then sent to OpenAI.');
    expect(r.steps[2]).toMatchObject({ label: 'Secrets removed', kind: 'cleaned', detail: '2 found (github token, password) and replaced before the prompt left the company.' });
  });

  it('says a clean prompt was checked for secrets', () => {
    expect(buildEvidenceRecord(log({ metadata: { secretsChecked: 'true' } }), 90).steps[2].label).toBe('No secrets found');
  });

  it('mentions rules that flagged without stopping', () => {
    const r = buildEvidenceRecord(log({ triggeredRules: ['r_flag'] }), 90);
    expect(r.steps[1].detail).toBe('1 rule flagged it without stopping it.');
  });
});

describe('evidence list', () => {
  const logs = [
    log({ requestId: 'a', eventType: 'request_blocked', metadata: { policyReason: 'Stop codenames' } }),
    log({ requestId: 'b', piiDetected: true, appId: 'support-bot' }),
    log({ requestId: 'c', userId: 'm.chen' }),
  ];

  it('filters by outcome', () => {
    expect(listEvidence(logs, { outcome: 'stopped' }).items.map((i) => i.requestId)).toEqual(['a']);
    expect(listEvidence(logs, { outcome: 'cleaned' }).items.map((i) => i.requestId)).toEqual(['b']);
  });

  it('searches people, apps, rules and IDs', () => {
    expect(listEvidence(logs, { q: 'codenames' }).items.map((i) => i.requestId)).toEqual(['a']);
    expect(listEvidence(logs, { q: 'M.CHEN' }).items.map((i) => i.requestId)).toEqual(['c']);
    expect(listEvidence(logs, { q: 'support' }).items.map((i) => i.requestId)).toEqual(['b']);
  });

  it('pages through results', () => {
    const page = listEvidence(logs, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextOffset).toBe(2);
    expect(listEvidence(logs, { limit: 2, offset: 2 }).nextOffset).toBeNull();
  });
});

describe('what lists and counts say about unanswered requests and agents', () => {
  const { summarizeGatewayTraffic } = jest.requireActual('../reports/gateway-summary');
  const { ruleActivity } = jest.requireActual('../reports/cost');
  const range = { from: '2026-10-27T00:00:00.000Z', to: '2026-10-28T00:00:00.000Z' };
  const refused = log({ requestId: 'r', piiDetected: true, metadata: { providerError: 'Provider bedrock: not available' } });
  const answered = log({ requestId: 'a' });
  const mcp = log({ requestId: 'm', piiDetected: true, modelId: 'mcp:people/getPerson', metadata: { kind: 'mcp_tool_call', mcpServer: 'people', mcpTool: 'getPerson', backendStatus: '200' } });

  it('marks refused requests and agents’ calls in the list', () => {
    const items = listEvidence([refused, answered, mcp], {}).items;
    expect(items.find((i) => i.requestId === 'r')).toMatchObject({ unanswered: true, outcome: 'cleaned' });
    expect(items.find((i) => i.requestId === 'a')?.unanswered).toBeUndefined();
    expect(items.find((i) => i.requestId === 'm')).toMatchObject({ mcp: { server: 'people', tool: 'getPerson' } });
  });

  it('counts a refused request as sent and checked, but not delivered', () => {
    const s = summarizeGatewayTraffic([refused, answered], range);
    expect(s).toMatchObject({ received: 2, delivered: 1, unanswered: 1, cleaned: 1 });
    expect(s.checks.personalData.cleaned).toBe(1);
    expect(s.providers).toEqual([{ name: 'OpenAI', count: 1 }]);
    expect(s.recent.find((e: { unanswered?: true }) => e.unanswered)).toBeDefined();
  });

  it('counts personal data removed from prompts on the Rules page, not from agents’ results', () => {
    expect(ruleActivity([refused, answered, mcp]).cleaned).toBe(1);
  });
});
