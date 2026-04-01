import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:contact');

const contactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  company: z.string().min(1),
  role: z.string().optional(),
  deploymentInterest: z.enum(['saas', 'onprem', 'both']),
  message: z.string().optional(),
});

export async function contactRoutes(app: FastifyInstance) {
  const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
  const bucket = process.env.AUDIT_LOG_BUCKET || 'ai-governance-audit-logs';

  app.post('/contact', async (request, reply) => {
    const body = contactSchema.parse(request.body);

    const submission = {
      ...body,
      submittedAt: new Date().toISOString(),
      source: 'website-contact-form',
    };

    try {
      // Store in S3 for CRM/follow-up
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `contact-submissions/${submission.submittedAt}-${body.email.replace('@', '_at_')}.json`,
          Body: JSON.stringify(submission),
          ContentType: 'application/json',
        })
      );
      logger.info('Contact form submission stored', { email: body.email, company: body.company });
    } catch (err) {
      // Don't fail the request if S3 write fails
      logger.error('Failed to store contact submission', { error: err });
    }

    return reply.status(201).send({
      success: true,
      message: 'Thank you — we will be in touch within one business day.',
    });
  });
}
