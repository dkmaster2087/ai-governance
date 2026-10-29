import Fastify from 'fastify';
import { AuditLog } from '@ai-governance/types';
import { buildEvidenceRecord, listEvidence } from '../services/evidence';

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

  it('is explicit when a check was skipped because it was down', () => {
    const r = buildEvidenceRecord(log({ metadata: { governanceDegraded: 'policy_evaluation' } }), 90);
    expect(r.steps[1]).toMatchObject({ label: 'Policy rules skipped', kind: 'skipped' });
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

const send = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/lib-dynamodb'),
  DynamoDBDocumentClient: { from: () => ({ send }) },
}));
jest.mock('../services/tenant-settings.service', () => ({ tenantSettings: () => ({ getSettings: async () => ({ auditLogRetentionDays: 90 }) }) }));
jest.mock('../services/audit-query', () => ({ queryAuditLogs: jest.fn(async () => ({ logs: [], truncated: false })) }));

describe('evidence routes', () => {
  async function app() {
    const { evidenceRoutes } = await import('../routes/evidence.routes');
    const a = Fastify();
    a.decorateRequest('principal', null);
    a.addHook('preHandler', async (req: any) => {
      req.principal = { kind: 'user', homeTenantId: 'tenant_acme', userId: 'u1', role: 'tenant_auditor' };
      req.tenantId = 'tenant_acme';
      req.userId = 'u1';
    });
    await a.register(evidenceRoutes, { prefix: '/v1' });
    return a;
  }

  it('looks records up under the caller’s tenant only', async () => {
    send.mockResolvedValue({ Item: undefined });
    const res = await (await app()).inject({ method: 'GET', url: '/v1/evidence/someone-elses-request' });
    expect(res.statusCode).toBe(404);
    expect(send.mock.calls[0][0].input.Key).toEqual({ tenantId: 'tenant_acme', requestId: 'someone-elses-request' });
  });

  it('exports a record as a downloadable file', async () => {
    send.mockResolvedValue({ Item: log({}) });
    const res = await (await app()).inject({ method: 'GET', url: '/v1/evidence/req-1/export' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="aegis-evidence-req-1.json"');
    expect(JSON.parse(res.body).record.requestId).toBe('req-1');
  });
});
