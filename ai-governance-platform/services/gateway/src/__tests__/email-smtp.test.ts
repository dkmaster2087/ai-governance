import nodemailer from 'nodemailer';
import Fastify from 'fastify';
import { collection, MemoryStore, setRecords } from '@ai-governance/storage';
import { Email, Mailer, mailerFromEnv, setMailer, SmtpMailer, smtpFromEnv } from '../services/email';
import { noticeDue, noticeText, sendLicenseNotices } from '../services/license-notices';
import { LicenseStatus, setLicenseState } from '../services/license-state';
import { RecordedAccounts, setUserDirectory, UserDirectory } from '../services/user-directory';

class FakeMailer implements Mailer {
  enabled = true;
  kind = 'smtp' as const;
  sent: Email[] = [];
  fail = false;
  async send(e: Email) { if (this.fail) throw new Error('550 relay denied'); this.sent.push(e); }
}

describe('SMTP settings', () => {
  it('is off without SMTP_HOST, and defaults to STARTTLS on 587', () => {
    expect(smtpFromEnv({})).toBeNull();
    expect(smtpFromEnv({ SMTP_HOST: 'mail.acme.com', SMTP_FROM: 'probaline@acme.com' })).toEqual({ host: 'mail.acme.com', port: 587, tls: 'starttls', from: 'probaline@acme.com' });
    expect(smtpFromEnv({ SMTP_HOST: 'mail.acme.com', SMTP_FROM: 'p@acme.com', SMTP_TLS: 'tls', SMTP_USER: 'u', SMTP_PASSWORD: 'pw' }))
      .toMatchObject({ port: 465, tls: 'tls', user: 'u', password: 'pw' });
    expect(() => smtpFromEnv({ SMTP_HOST: 'mail.acme.com' })).toThrow(/SMTP_FROM/);
  });

  it('uses the company’s mail server when set, SES otherwise', () => {
    process.env.SMTP_HOST = 'mail.acme.com'; process.env.SMTP_FROM = 'p@acme.com';
    try { expect(mailerFromEnv().kind).toBe('smtp'); } finally { delete process.env.SMTP_HOST; delete process.env.SMTP_FROM; }
    expect(mailerFromEnv().kind).toBe('none');
  });

  it('sends one plain-text message, its subject on one line', async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const m = new SmtpMailer({ host: 'x', port: 587, tls: 'starttls', from: 'Probaline <probaline@acme.com>' }, transport);
    const spy = jest.spyOn(transport, 'sendMail');
    await m.send({ to: ['ana@acme.com', ''], subject: 'Line one\r\nBcc: evil@x.com', text: 'Hello' });
    const msg = spy.mock.calls[0][0] as any;
    expect(msg).toMatchObject({ from: 'Probaline <probaline@acme.com>', to: ['ana@acme.com'], text: 'Hello' });
    expect(msg.subject).toBe('Line one Bcc: evil@x.com');
    const raw = String(((await spy.mock.results[0].value) as any).message);
    expect(raw).not.toMatch(/^Bcc:/m);
    await expect(m.send({ to: [], subject: 's', text: 't' })).rejects.toThrow(/No recipients/);
  });
});

describe('license notices by email', () => {
  const st = (over: Partial<LicenseStatus>): LicenseStatus => ({ state: 'expiring', endsAt: '2027-01-31T00:00:00Z', daysLeft: 25, ...over });

  it('picks the next notice point, and starts afresh after a renewal', () => {
    expect(noticeDue(st({ state: 'active', daysLeft: undefined }))).toBeNull();
    expect(noticeDue(st({ daysLeft: 45 }))).toBeNull();
    expect(noticeDue(st({ daysLeft: 25 }))).toBe('expiring#2027-01-31T00:00:00Z#30');
    expect(noticeDue(st({ daysLeft: 10 }))).toBe('expiring#2027-01-31T00:00:00Z#14');
    expect(noticeDue(st({ daysLeft: 1 }))).toBe('expiring#2027-01-31T00:00:00Z#1');
    expect(noticeDue(st({ endsAt: '2028-01-31T00:00:00Z', daysLeft: 25 }))).toBe('expiring#2028-01-31T00:00:00Z#30');
    expect(noticeDue(st({ state: 'grace', graceUntil: '2027-03-02T00:00:00Z', daysLeft: 6 }))).toBe('grace#2027-03-02T00:00:00Z#7');
    expect(noticeDue(st({ state: 'lapsed', graceUntil: '2027-03-02T00:00:00Z' }))).toBe('lapsed#2027-03-02T00:00:00Z');
    expect(noticeText(st({ state: 'lapsed', graceUntil: '2027-03-02T00:00:00Z' }), 'Acme', 'https://ai-gateway.acme.com').text)
      .toMatch(/stopped on .*\n\n.*\n\nOpen the License page: https:\/\/ai-gateway\.acme\.com\/license/s);
  });

  describe('sending', () => {
    let status: LicenseStatus = st({});
    const mail = new FakeMailer();
    beforeEach(async () => {
      setRecords(new MemoryStore());
      setUserDirectory(new UserDirectory(new RecordedAccounts()));
      setLicenseState({ get: async () => status, invalidate: () => {} } as never);
      mail.sent = []; mail.fail = false; mail.enabled = true;
      status = st({});
      await collection('tenants').put({ tenantId: 't1', name: 'Acme', status: 'active' });
      const users = collection('users');
      await users.put({ tenantId: 't1', email: 'boss@acme.com', role: 'tenant_admin', status: 'active' });
      await users.put({ tenantId: 't1', email: 'gone@acme.com', role: 'tenant_admin', status: 'disabled' });
      await users.put({ tenantId: 't1', email: 'aud@acme.com', role: 'tenant_auditor', status: 'active' });
    });
    afterAll(() => { setLicenseState(null); setUserDirectory(null); });

    it('emails active admins once per notice, whatever the number of passes', async () => {
      expect(await sendLicenseNotices(mail)).toBe(1);
      expect(await sendLicenseNotices(mail)).toBe(0);
      expect(mail.sent).toEqual([expect.objectContaining({ to: ['boss@acme.com'], subject: 'Probaline license for Acme ends in 25 days' })]);
      status = st({ daysLeft: 13 });
      expect(await sendLicenseNotices(mail)).toBe(1);
      expect(mail.sent[1].subject).toBe('Probaline license for Acme ends in 13 days');
    });

    it('tries again next time when the mail server refuses, and sends nothing with email off', async () => {
      mail.fail = true;
      expect(await sendLicenseNotices(mail)).toBe(0);
      mail.fail = false;
      expect(await sendLicenseNotices(mail)).toBe(1);
      mail.enabled = false;
      status = st({ daysLeft: 5 });
      expect(await sendLicenseNotices(mail)).toBe(0);
    });
  });
});

describe('the test email', () => {
  afterAll(() => setMailer(null));
  async function appAs(email?: string) {
    const { alertRoutes } = await import('../routes/alert.routes');
    const app = Fastify();
    app.decorateRequest('principal', null);
    app.addHook('preHandler', async (req: any) => { req.principal = { kind: 'user', homeTenantId: 't1', userId: 'u1', role: 'tenant_admin', email }; req.tenantId = 't1'; req.userId = 'u1'; });
    await app.register(alertRoutes, { prefix: '/v1' });
    return app;
  }

  it('goes to the admin asking, and reports the mail server’s refusal', async () => {
    const mail = new FakeMailer();
    setMailer(mail);
    const app = await appAs('boss@acme.com');
    expect((await app.inject({ method: 'GET', url: '/v1/alerts/delivery' })).json()).toEqual({ email: true, via: 'smtp' });
    expect((await app.inject({ method: 'POST', url: '/v1/alerts/email-test', payload: {} })).json()).toMatchObject({ sent: true, to: 'boss@acme.com' });
    expect(mail.sent[0]).toMatchObject({ to: ['boss@acme.com'], subject: 'Probaline test email' });
    mail.fail = true;
    const refused = await app.inject({ method: 'POST', url: '/v1/alerts/email-test', payload: {} });
    expect(refused.statusCode).toBe(502);
    expect(refused.json().error).toBe('The mail server refused: 550 relay denied');
    mail.enabled = false;
    expect((await app.inject({ method: 'POST', url: '/v1/alerts/email-test', payload: {} })).statusCode).toBe(409);
  });
});
