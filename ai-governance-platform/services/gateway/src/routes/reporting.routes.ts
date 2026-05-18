import { FastifyInstance } from 'fastify';
import { createLogger } from '@ai-governance/utils';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const logger = createLogger('gateway:reporting');

export async function reportingRoutes(app: FastifyInstance) {
  const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const client = DynamoDBDocumentClient.from(dynamo);
  const tenantsTable = process.env.TENANTS_TABLE || 'ai-gov-tenants-dev';

  /** Validate a license key from an on-prem agent */
  app.post('/reporting/validate-license', async (request, reply) => {
    const body = request.body as any;
    const { licenseKey, tenantId, agentVersion } = body;

    if (!licenseKey || !tenantId) {
      return reply.status(400).send({ valid: false, error: 'Missing licenseKey or tenantId' });
    }

    // In production, validate against a licenses table
    // For now, accept any key that starts with AEGIS-
    const valid = licenseKey.startsWith('AEGIS-') || licenseKey.startsWith('aegis_');

    logger.info('License validation request', { tenantId, valid, agentVersion });

    return reply.send({
      valid,
      tenantId,
      message: valid ? 'License validated successfully' : 'Invalid license key',
      serverTime: new Date().toISOString(),
    });
  });

  /** Ingest a report from an on-prem agent */
  app.post('/reporting/ingest', async (request, reply) => {
    const body = request.body as any;
    const { licenseKey, tenantId, timestamp, agentVersion, data } = body;

    if (!licenseKey || !tenantId) {
      return reply.status(400).send({ error: 'Missing licenseKey or tenantId' });
    }

    // Validate license
    const validLicense = licenseKey.startsWith('AEGIS-') || licenseKey.startsWith('aegis_');
    if (!validLicense) {
      return reply.status(403).send({ error: 'Invalid license key' });
    }

    logger.info('Report ingested', {
      tenantId,
      agentVersion,
      hasUsage: !!data?.usageMetrics,
      hasCost: !!data?.costData,
      hasCompliance: !!data?.complianceStatus,
      hasAudit: !!data?.auditLogs,
    });

    // Store the report (in production, process and aggregate)
    // For now, just acknowledge receipt
    return reply.send({
      accepted: true,
      reportId: `rpt_${randomUUID().slice(0, 12)}`,
      tenantId,
      receivedAt: new Date().toISOString(),
      nextReportExpectedBy: new Date(Date.now() + 600000).toISOString(), // 10 min
    });
  });

  /** Get reporting status for a tenant (platform admin view) */
  app.get('/reporting/status/:tenantId', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    // In production, query the reports table for last report time, etc.
    return reply.send({
      tenantId,
      lastReportAt: null,
      reportsReceived: 0,
      agentVersion: null,
      status: 'awaiting_first_report',
    });
  });
}
