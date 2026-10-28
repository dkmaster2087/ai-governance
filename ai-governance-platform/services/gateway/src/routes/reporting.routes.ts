import { FastifyInstance } from 'fastify';
import { createLogger } from '@ai-governance/utils';
import { ApiKeyRepository, hashApiKey } from '../repositories/api-key.repository';
import { requireAccess, requireTenantParam, TENANT_READ } from '../auth/guards';
import { randomUUID } from 'crypto';

const logger = createLogger('gateway:reporting');

export async function reportingRoutes(app: FastifyInstance) {
  const keys = new ApiKeyRepository();

  /**
   * On-prem licenses are credentials stored like API keys: hashed, tenant-bound, with an expiry and the
   * 'reporting:ingest' scope. The agent sends the raw key in the body (these two routes skip header auth).
   */
  async function checkLicense(licenseKey: unknown, tenantId: unknown): Promise<{ ok: true } | { ok: false; status: 400 | 403; error: string }> {
    if (typeof licenseKey !== 'string' || typeof tenantId !== 'string' || !licenseKey || !tenantId) {
      return { ok: false, status: 400, error: 'Missing licenseKey or tenantId' };
    }
    const key = await keys.findByHash(hashApiKey(licenseKey));
    const expired = key?.expiresAt ? new Date(key.expiresAt) < new Date() : false;
    if (!key || key.status !== 'active' || expired || key.tenantId !== tenantId || !key.scopes?.includes('reporting:ingest')) {
      return { ok: false, status: 403, error: 'Invalid license key' };
    }
    keys.touchLastUsed(key.tenantId, key.keyId).catch(() => {});
    return { ok: true };
  }

  /** Validate a license key from an on-prem agent */
  app.post('/reporting/validate-license', async (request, reply) => {
    const { licenseKey, tenantId, agentVersion } = (request.body ?? {}) as Record<string, unknown>;
    const result = await checkLicense(licenseKey, tenantId);
    if (!result.ok && result.status === 400) return reply.status(400).send({ valid: false, error: result.error });

    logger.info('License validation request', { tenantId, valid: result.ok, agentVersion });
    return reply.send({
      valid: result.ok,
      tenantId,
      message: result.ok ? 'License validated successfully' : 'Invalid license key',
      serverTime: new Date().toISOString(),
    });
  });

  /** Ingest a report from an on-prem agent */
  app.post('/reporting/ingest', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, any>;
    const { licenseKey, tenantId, agentVersion, data } = body;
    const result = await checkLicense(licenseKey, tenantId);
    if (!result.ok) return reply.status(result.status).send({ error: result.error });

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
  app.get('/reporting/status/:tenantId', { preHandler: [requireAccess(TENANT_READ), requireTenantParam] }, async (request, reply) => {
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
