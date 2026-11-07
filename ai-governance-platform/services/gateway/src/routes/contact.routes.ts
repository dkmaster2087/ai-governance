import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { objects } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { mailer, oneLine } from '../services/email';

const logger = createLogger('gateway:contact');

const contactSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().email().max(254),
  company: z.string().trim().min(1).max(200),
  role: z.string().max(200).optional(),
  deploymentInterest: z.enum(['saas', 'onprem', 'both']),
  message: z.string().max(5000).optional(),
  /** Hidden on the form; people leave it empty, bots fill it in. */
  website: z.string().optional(),
});

const INTEREST = { saas: 'Cloud (SaaS)', onprem: 'On premises', both: 'Both' } as const;

/**
 * The website's contact form. Each enquiry is kept in the audit bucket, then emailed to the team
 * (CONTACT_EMAIL_TO, comma separated) with the visitor as the reply-to address. If the email can't be sent
 * the visitor still gets their thank-you: the copy is kept and the failure is logged for the operator.
 */
export async function contactRoutes(app: FastifyInstance) {
  const bucket = process.env.AUDIT_LOG_BUCKET || 'ai-governance-audit-logs';
  const recipients = () => (process.env.CONTACT_EMAIL_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const thanks = { success: true, message: 'Thank you — we will be in touch within one business day.' };

  app.post('/contact', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request, reply) => {
    const parsed = contactSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Please check the form', code: 'INVALID_CONTACT', fields: parsed.error.issues.map((i) => i.path.join('.')) });
    }
    const { website, ...body } = parsed.data;
    if (website) {
      logger.info('Contact form: ignored a submission that filled in the hidden field');
      return reply.status(201).send(thanks);
    }

    const submission = { ...body, submittedAt: new Date().toISOString(), source: 'website-contact-form' };

    try {
      const key = `contact-submissions/${submission.submittedAt}-${body.email.replace('@', '_at_')}.json`.replace(/[^A-Za-z0-9._\/-]/g, '_');
      await objects(bucket).put(key, JSON.stringify(submission), 'application/json');
      logger.info('Contact form submission stored', { company: body.company });
    } catch (err) {
      // Tell the visitor rather than silently losing their enquiry.
      logger.error('Failed to store contact submission', { error: (err as Error).message });
      return reply.status(503).send({ error: 'We couldn’t send your message. Please try again or email us.', code: 'CONTACT_UNAVAILABLE' });
    }

    const to = recipients();
    const m = mailer();
    if (to.length && m.enabled) {
      try {
        await m.send({
          to,
          replyTo: body.email,
          subject: `Website enquiry: ${oneLine(body.company, 80)} (${oneLine(`${body.firstName} ${body.lastName}`, 80)})`,
          text: [
            `${body.firstName} ${body.lastName}${body.role ? `, ${body.role}` : ''}`,
            body.company,
            body.email,
            `Interested in: ${INTEREST[body.deploymentInterest]}`,
            '',
            body.message?.trim() || '(no message)',
            '',
            `Sent from the website's contact form at ${submission.submittedAt}. Reply to this email to answer them.`,
          ].join('\n'),
        });
      } catch (err) {
        logger.error('Contact form: the enquiry was kept but the email to the team failed', { error: (err as Error).message, company: body.company });
      }
    } else {
      logger.warn('Contact form: email to the team is off (set CONTACT_EMAIL_TO and EMAIL_FROM); the enquiry is only in the bucket');
    }

    return reply.status(201).send(thanks);
  });
}
