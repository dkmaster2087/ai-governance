import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import nodemailer, { Transporter } from 'nodemailer';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:email');

/**
 * Plain-text email: alerts, license notices and the website's contact form. Two ways to send:
 * - SMTP, for a customer-run install: the company's own mail relay (Exchange, a Microsoft 365 or Google Workspace
 *   relay, Postfix, SendGrid…). SMTP_HOST turns it on. Mail goes from their gateway to their mail server, never
 *   through Probaline.
 * - Amazon SES, in AWS: EMAIL_FROM, an address or domain verified in SES.
 * With neither, `enabled` is false and callers say so (the Alerts page) or keep their own copy.
 */
export interface Email {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
}

export interface Mailer {
  readonly enabled: boolean;
  /** How mail leaves: shown on the Alerts page. */
  readonly kind: 'smtp' | 'ses' | 'none';
  send(email: Email): Promise<void>;
}

/** Subjects are one line, without control characters, at most 200 characters. */
export const oneLine = (s: string, max = 200) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export class SesMailer implements Mailer {
  constructor(
    private from = process.env.EMAIL_FROM ?? '',
    private client: Pick<SESv2Client, 'send'> = new SESv2Client({}),
  ) {}

  get enabled() { return Boolean(this.from); }
  get kind() { return this.enabled ? 'ses' as const : 'none' as const; }

  async send(email: Email): Promise<void> {
    if (!this.enabled) throw new Error('Email is not configured (EMAIL_FROM)');
    const to = email.to.filter(Boolean);
    if (!to.length) throw new Error('No recipients');
    await this.client.send(new SendEmailCommand({
      FromEmailAddress: this.from,
      Destination: { ToAddresses: to },
      ...(email.replyTo ? { ReplyToAddresses: [email.replyTo] } : {}),
      Content: { Simple: { Subject: { Data: oneLine(email.subject), Charset: 'UTF-8' }, Body: { Text: { Data: email.text, Charset: 'UTF-8' } } } },
    }));
    logger.info('Email sent', { recipients: to.length, subject: oneLine(email.subject, 80) });
  }
}

/** The company's mail server's settings. */
export interface SmtpSettings {
  host: string;
  port: number;
  /** starttls (port 587, the default): upgrade to TLS, and refuse to send if the server can't. tls (port 465): TLS from the start. */
  tls: 'starttls' | 'tls';
  user?: string;
  password?: string;
  from: string;
}

export function smtpFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpSettings | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const tls = (env.SMTP_TLS ?? '').toLowerCase() === 'tls' ? 'tls' : 'starttls';
  const from = (env.SMTP_FROM ?? env.EMAIL_FROM ?? '').trim();
  if (!from) throw new Error('SMTP_HOST is set but SMTP_FROM is not: set the address Probaline sends from');
  return {
    host, tls, from,
    port: Number(env.SMTP_PORT) || (tls === 'tls' ? 465 : 587),
    ...(env.SMTP_USER ? { user: env.SMTP_USER, password: env.SMTP_PASSWORD ?? '' } : {}),
  };
}

/**
 * Through the company's own mail server. The connection is always encrypted and the server's certificate checked
 * (SMTP_CA, a PEM file's text, for a server signed by the company's own certificate authority).
 */
export class SmtpMailer implements Mailer {
  readonly enabled = true;
  readonly kind = 'smtp' as const;
  private transport: Transporter;
  constructor(private settings: SmtpSettings, transport?: Transporter) {
    this.transport = transport ?? nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.tls === 'tls',
      requireTLS: settings.tls === 'starttls',
      ...(settings.user ? { auth: { user: settings.user, pass: settings.password } } : {}),
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, ...(process.env.SMTP_CA ? { ca: process.env.SMTP_CA } : {}) },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async send(email: Email): Promise<void> {
    const to = email.to.filter(Boolean);
    if (!to.length) throw new Error('No recipients');
    await this.transport.sendMail({
      from: this.settings.from,
      to,
      ...(email.replyTo ? { replyTo: email.replyTo } : {}),
      subject: oneLine(email.subject),
      text: email.text,
    });
    logger.info('Email sent', { via: 'smtp', recipients: to.length, subject: oneLine(email.subject, 80) });
  }
}

/** SMTP when SMTP_HOST is set (a customer-run install), otherwise SES (in AWS, with EMAIL_FROM). */
export function mailerFromEnv(): Mailer {
  const smtp = smtpFromEnv();
  return smtp ? new SmtpMailer(smtp) : new SesMailer();
}

let shared: Mailer | null = null;
export const mailer = (): Mailer => (shared ??= mailerFromEnv());
export const setMailer = (m: Mailer | null) => { shared = m; };
