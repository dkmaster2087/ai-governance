import Fastify, { FastifyInstance } from 'fastify';
import { MemoryObjectStore, setObjects } from '@ai-governance/storage';
import { contactRoutes } from '../routes/contact.routes';
import { Email, Mailer, oneLine, SesMailer, setMailer } from '../services/email';

const FORM = { firstName: 'Ana', lastName: 'Silva', email: 'ana@acme.example', company: 'Acme', role: 'CISO', deploymentInterest: 'onprem', message: 'Can we run it ourselves?' };

class FakeMailer implements Mailer {
  kind = 'ses' as const;
  sent: Email[] = [];
  fail = false;
  constructor(public enabled = true) {}
  async send(e: Email) { if (this.fail) throw new Error('SES down'); this.sent.push(e); }
}

describe('Website contact form', () => {
  let store: MemoryObjectStore;
  let mail: FakeMailer;
  let app: FastifyInstance;
  const post = (body: object) => app.inject({ method: 'POST', url: '/contact', payload: body });

  beforeEach(async () => {
    store = new MemoryObjectStore();
    setObjects(store);
    mail = new FakeMailer();
    setMailer(mail);
    process.env.CONTACT_EMAIL_TO = 'sales@probaline.example, founder@probaline.example';
    app = Fastify();
    await app.register(contactRoutes);
  });
  afterEach(() => { setObjects(null); setMailer(null); delete process.env.CONTACT_EMAIL_TO; });

  it('keeps the enquiry and emails the team, with the visitor as the reply-to', async () => {
    const res = await post(FORM);
    expect(res.statusCode).toBe(201);
    expect(store.objects.size).toBe(1);
    expect(mail.sent).toHaveLength(1);
    const e = mail.sent[0];
    expect(e.to).toEqual(['sales@probaline.example', 'founder@probaline.example']);
    expect(e.replyTo).toBe('ana@acme.example');
    expect(e.subject).toBe('Website enquiry: Acme (Ana Silva)');
    expect(e.text).toContain('Interested in: On premises');
    expect(e.text).toContain('Can we run it ourselves?');
  });

  it('still thanks the visitor when the email fails, because the enquiry is kept', async () => {
    mail.fail = true;
    expect((await post(FORM)).statusCode).toBe(201);
    expect(store.objects.size).toBe(1);
  });

  it('keeps the enquiry when email is off', async () => {
    setMailer(new FakeMailer(false));
    expect((await post(FORM)).statusCode).toBe(201);
    expect(store.objects.size).toBe(1);
  });

  it('quietly ignores bots that fill in the hidden field', async () => {
    expect((await post({ ...FORM, website: 'http://spam.example' })).statusCode).toBe(201);
    expect(store.objects.size).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it('refuses incomplete forms and keeps nothing', async () => {
    const res = await post({ ...FORM, email: 'not-an-email' });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toContain('email');
    expect(store.objects.size).toBe(0);
  });

  it('can\'t be used to add mail headers through the subject', async () => {
    await post({ ...FORM, company: 'Acme\r\nBcc: victim@example.com' });
    expect(mail.sent[0].subject).not.toMatch(/[\r\n]/);
    expect(oneLine('a\nb\tc')).toBe('a b c');
  });

  it('sends through SES from the configured address', async () => {
    const send = jest.fn(async () => ({}));
    const ses = new SesMailer('Probaline <no-reply@probaline.example>', { send } as any);
    await ses.send({ to: ['sales@probaline.example'], subject: 'Hi', text: 'Body', replyTo: 'ana@acme.example' });
    const input = (send.mock.calls[0] as any[])[0].input;
    expect(input).toMatchObject({ FromEmailAddress: 'Probaline <no-reply@probaline.example>', Destination: { ToAddresses: ['sales@probaline.example'] }, ReplyToAddresses: ['ana@acme.example'] });
    expect(new SesMailer('').enabled).toBe(false);
  });
});
