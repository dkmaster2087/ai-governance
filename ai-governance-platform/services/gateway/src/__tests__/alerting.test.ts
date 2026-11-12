import Fastify, { FastifyInstance } from 'fastify';
import { collection, MemoryStore, setRecords } from '@ai-governance/storage';
import { AuditLog } from '@ai-governance/types';
import { AlertingService, AlertRule, setAlerting } from '../services/alerting.service';
import { Email, Mailer } from '../services/email';
import { verifySignature } from '../log-export/formats';
import { setAnalyticsClient } from '../clients/analytics.client';

class FakeMailer implements Mailer {
  kind = 'ses' as const;
  enabled = true;
  sent: Email[] = [];
  async send(e: Email) { this.sent.push(e); }
}

const log = (over: Partial<AuditLog> = {}): AuditLog => ({
  logId: 'l', requestId: `r-${Math.random()}`, tenantId: 'tenant_acme', userId: 'ana', appId: 'app', eventType: 'request_allowed',
  provider: 'openai', modelId: 'gpt', promptHash: '', responseHash: '', policyDecision: 'allow', triggeredRules: [], piiDetected: false,
  piiTypes: [], inputTokens: 0, outputTokens: 0, estimatedCost: 0, latencyMs: 1, timestamp: new Date().toISOString(), metadata: {}, ...over,
} as AuditLog);

describe('alerts', () => {
  let mail: FakeMailer;
  let posts: Array<{ url: string; headers: Record<string, string>; body: string }>;
  let status: number;
  let clock: Date;
  let service: AlertingService;

  const rule = (over: Partial<AlertRule>): AlertRule => ({
    tenantId: 'tenant_acme', ruleId: `alert_${Math.random().toString(16).slice(2, 10)}`, name: 'Spike', kind: 'stopped_spike', enabled: true,
    config: { count: 3, minutes: 60 }, emails: ['sec@acme.example'], createdAt: '2026-11-01T00:00:00Z', createdBy: 'u', updatedAt: '', firedCount: 0, ...over,
  });

  beforeEach(() => {
    setRecords(new MemoryStore());
    mail = new FakeMailer(); posts = []; status = 200; clock = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 + 5 * 60_000); // 5 minutes into this hour
    service = new AlertingService(() => mail, async (url, headers, body) => { posts.push({ url, headers, body }); return status; }, () => clock, 0);
  });

  it('fires once when stopped requests reach the count within the window, then again in the next window', async () => {
    await service.save(rule({}));
    for (let i = 0; i < 5; i++) await service.fromAuditRecord(log({ eventType: 'request_blocked' }));
    await service.fromAuditRecord(log()); // delivered requests don't count
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: ['sec@acme.example'], subject: 'Probaline: 3 requests stopped in the last 1 hour' });

    clock = new Date(clock.getTime() + 3_600_000);
    for (let i = 0; i < 3; i++) await service.fromAuditRecord(log({ eventType: 'request_blocked' }));
    expect(mail.sent).toHaveLength(2);
    const events = await service.events('tenant_acme');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: 'stopped_spike', delivery: { email: 'sent' } });
    expect((await service.rule('tenant_acme', (await service.rules('tenant_acme'))[0].ruleId))?.firedCount).toBe(2);
  });

  it('watches personal data removed from answers and tool results, ignoring tests and other companies', async () => {
    await service.save(rule({ kind: 'answer_pii', config: { count: 2, minutes: 30 } }));
    await service.fromAuditRecord(log({ metadata: { answerPiiRemoved: 'true' } }));
    await service.fromAuditRecord(log({ tenantId: 'tenant_other', metadata: { answerPiiRemoved: 'true' } }));
    await service.fromAuditRecord(log({ piiDetected: true, metadata: { kind: 'mcp_tool_call', test: 'true' } }));
    expect(mail.sent).toHaveLength(0);
    await service.fromAuditRecord(log({ piiDetected: true, metadata: { kind: 'mcp_tool_call' } }));
    expect(mail.sent[0].subject).toBe('Probaline: Personal data was removed from 2 AI answers');
    // Personal data removed from a prompt (not an answer) isn't this alert.
    await service.fromAuditRecord(log({ piiDetected: true }));
    expect(mail.sent).toHaveLength(1);
  });

  it('counts shadow AI visits in batches', async () => {
    await service.save(rule({ kind: 'shadow_ai', config: { count: 5, minutes: 60 } }));
    await service.fromShadowAi('tenant_acme', 3);
    expect(mail.sent).toHaveLength(0);
    await service.fromShadowAi('tenant_acme', 4);
    expect(mail.sent).toHaveLength(1);
    await service.fromShadowAi('tenant_acme', 10);
    expect(mail.sent).toHaveLength(1);
  });

  it('fires once a month when spend crosses the line, counting what was spent before the alert existed', async () => {
    await service.save(rule({ kind: 'spend', config: { monthlyBudgetUSD: 100, percent: 80 } }));
    await service.seedSpend('tenant_acme', 75);
    await service.fromAuditRecord(log({ estimatedCost: 4 }));
    expect(mail.sent).toHaveLength(0);
    await service.fromAuditRecord(log({ estimatedCost: 2 }));
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].text).toContain('Spent so far this month: $81.00');
    await service.fromAuditRecord(log({ estimatedCost: 50 }));
    expect(mail.sent).toHaveLength(1);
    clock = new Date(Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth() + 1, 2));
    await service.fromAuditRecord(log({ estimatedCost: 85 }));
    expect(mail.sent).toHaveLength(2);
  });

  it('signs webhooks, and records a failed delivery', async () => {
    const r = rule({ emails: [], webhookUrl: 'https://hooks.acme.example/probaline', signingSecret: 'whsec_test', config: { count: 1, minutes: 60 } });
    await service.save(r);
    await service.fromAuditRecord(log({ eventType: 'request_blocked' }));
    const p = posts[0];
    expect(p.url).toBe('https://hooks.acme.example/probaline');
    expect(verifySignature('whsec_test', p.body, p.headers['x-probaline-signature'], Math.floor(clock.getTime() / 1000))).toBe(true);
    expect(JSON.parse(p.body)).toMatchObject({ source: 'probaline', kind: 'stopped_spike', text: expect.stringContaining('requests stopped') });

    status = 500;
    clock = new Date(clock.getTime() + 3_600_000);
    await service.fromAuditRecord(log({ eventType: 'request_blocked' }));
    expect((await service.events('tenant_acme'))[0].delivery).toMatchObject({ webhook: 'failed', error: 'The webhook answered 500' });
  });

  it('leaves switched-off alerts alone', async () => {
    await service.save(rule({ enabled: false, config: { count: 1, minutes: 60 } }));
    await service.fromAuditRecord(log({ eventType: 'request_blocked' }));
    expect(mail.sent).toHaveLength(0);
  });

  describe('dashboard API', () => {
    let app: FastifyInstance;
    async function appAs(role: string) {
      const { alertRoutes } = await import('../routes/alert.routes');
      const a = Fastify();
      a.decorateRequest('principal', null);
      a.addHook('preHandler', async (req: any) => { req.principal = { kind: 'user', homeTenantId: 'tenant_acme', userId: 'u1', role }; req.tenantId = 'tenant_acme'; req.userId = 'u1'; });
      await a.register(alertRoutes, { prefix: '/v1' });
      return a;
    }
    beforeEach(async () => { setAlerting(service); app = await appAs('tenant_admin'); });
    afterEach(() => { setAlerting(null); setAnalyticsClient(null); });

    it('creates an alert, shows the webhook secret once, tests it and lists what fired', async () => {
      const created = await app.inject({ method: 'POST', url: '/v1/alerts/rules', payload: {
        name: 'Stops', kind: 'stopped_spike', config: { count: 5 }, emails: ['Sec@Acme.example'], webhookUrl: 'https://hooks.acme.example/x',
      } });
      expect(created.statusCode).toBe(201);
      const body = created.json();
      expect(body).toMatchObject({ kind: 'stopped_spike', config: { count: 5, minutes: 60 }, emails: ['sec@acme.example'], webhook: 'https://hooks.acme.example/x', description: '5 or more requests stopped within 1 hour' });
      expect(body.signingSecret).toMatch(/^whsec_/);
      const list = (await app.inject({ method: 'GET', url: '/v1/alerts/rules' })).json();
      expect(JSON.stringify(list)).not.toContain('whsec_');
      // Long webhook paths (which often hold a token, as Slack's do) are shortened.
      const slack = (await app.inject({ method: 'PATCH', url: `/v1/alerts/rules/${body.ruleId}`, payload: { webhookUrl: 'https://hooks.slack.example/services/T000/B000/abcdefSECRET' } })).json();
      expect(JSON.stringify(slack)).not.toContain('abcdefSECRET');

      const test = (await app.inject({ method: 'POST', url: `/v1/alerts/rules/${body.ruleId}/test` })).json();
      expect(test.delivery).toEqual({ email: 'sent', webhook: 'sent' });
      expect(mail.sent[0].subject).toBe('[Test] Probaline: Test: Stops');
      expect((await app.inject({ method: 'GET', url: '/v1/alerts/events' })).json()[0]).toMatchObject({ test: true });
      expect((await service.rule('tenant_acme', body.ruleId))?.firedCount).toBe(0); // tests don't count
    });

    it('refuses alerts with nowhere to go, private webhook addresses, and spend without a budget', async () => {
      const post = (payload: object) => app.inject({ method: 'POST', url: '/v1/alerts/rules', payload: { name: 'X', kind: 'stopped_spike', ...payload } });
      expect((await post({})).json().error).toMatch(/at least one email address or a webhook/);
      expect((await post({ webhookUrl: 'http://hooks.acme.example' })).json().error).toMatch(/https/);
      expect((await post({ webhookUrl: 'https://169.254.169.254/latest' })).json().error).toMatch(/Private addresses/);
      expect((await post({ emails: ['not-an-email'] })).statusCode).toBe(400);
      expect((await post({ kind: 'spend', emails: ['a@acme.example'] })).json().error).toMatch(/monthly budget/);
    });

    it('starts a new spend alert from what was already spent this month', async () => {
      setAnalyticsClient({ optional: async () => ({ totalCost: 89.5 }) } as any);
      await app.inject({ method: 'POST', url: '/v1/alerts/rules', payload: { name: 'Budget', kind: 'spend', config: { monthlyBudgetUSD: 100, percent: 90 }, emails: ['cfo@acme.example'] } });
      await service.fromAuditRecord(log({ estimatedCost: 1 }));
      expect(mail.sent[0].subject).toBe('Probaline: AI spend passed 90% of the monthly budget');
    });

    it('changes and removes alerts; a new webhook gets a new secret; auditors only look', async () => {
      const { ruleId } = (await app.inject({ method: 'POST', url: '/v1/alerts/rules', payload: { name: 'A', kind: 'shadow_ai', emails: ['a@acme.example'] } })).json();
      const changed = (await app.inject({ method: 'PATCH', url: `/v1/alerts/rules/${ruleId}`, payload: { enabled: false, webhookUrl: 'https://hooks.acme.example/y' } })).json();
      expect(changed).toMatchObject({ enabled: false, webhook: 'https://hooks.acme.example/y' });
      expect(changed.signingSecret).toMatch(/^whsec_/);
      expect((await app.inject({ method: 'PATCH', url: `/v1/alerts/rules/${ruleId}`, payload: { emails: [], webhookUrl: null } })).statusCode).toBe(400);

      const auditor = await appAs('tenant_auditor');
      expect((await auditor.inject({ method: 'GET', url: '/v1/alerts/rules' })).statusCode).toBe(200);
      expect((await auditor.inject({ method: 'DELETE', url: `/v1/alerts/rules/${ruleId}` })).statusCode).toBe(403);
      expect((await app.inject({ method: 'DELETE', url: `/v1/alerts/rules/${ruleId}` })).statusCode).toBe(204);
      expect(await collection('alerts').get({ tenantId: 'tenant_acme', ruleId })).toBeNull();
    });
  });
});
