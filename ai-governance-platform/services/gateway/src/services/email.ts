import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:email');

/**
 * Plain-text email through Amazon SES. Sending is on when EMAIL_FROM is set (an address or domain verified in
 * SES); otherwise `enabled` is false and callers keep their own copy. Used by the contact form and alerts.
 */
export interface Email {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
}

export interface Mailer {
  readonly enabled: boolean;
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

let shared: Mailer | null = null;
export const mailer = (): Mailer => (shared ??= new SesMailer());
export const setMailer = (m: Mailer | null) => { shared = m; };
