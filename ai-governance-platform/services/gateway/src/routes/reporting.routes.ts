import { FastifyInstance } from 'fastify';
import { createLogger } from '@ai-governance/utils';
import { ApiKeyRepository, hashApiKey } from '../repositories/api-key.repository';
import { requireAccess, requireTenantParam, TENANT_READ } from '../auth/guards';
import { randomUUID } from 'crypto';
import { collection } from '@ai-governance/storage';

/** How long received reports are kept. */
const REPORT_DAYS = 395;
const reports = () => collection<Record<string, any>>('metrics');

const logger = createLogger('gateway:reporting');

export async function reportingRoutes(app: FastifyInstance) {
  const keys = new ApiKeyRepository();

  /**
   * On-prem licenses are credentials stored like API keys: hashed, tenant-bound, with an expiry and the
   * 'reporting:ingest' scope. The agent sends the raw key in the body (these two routes skip header auth).
   */
  async function checkLicense(licenseKey: unknown, tenantId: unknown): Promise<{ ok: true; allowed: Record<string, boolean> } | { ok: false; status: 400 | 403; error: string }> {
    if (typeof licenseKey !== 'string' || typeof tenantId !== 'string' || !licenseKey || !tenantId) {
      return { ok: false, status: 400, error: 'Missing licenseKey or tenantId' };
    }
    const key = await keys.findByHash(hashApiKey(licenseKey));
    const expired = key?.expiresAt ? new Date(key.expiresAt) < new Date() : false;
    if (!key || key.status !== 'active' || expired || key.tenantId !== tenantId || !key.scopes?.includes('reporting:ingest')) {
      return { ok: false, status: 403, error: 'Invalid license key' };
    }
    keys.touchLastUsed(key.tenantId, key.keyId).catch(() => {});
    return { ok: true, allowed: { usageMetrics: true, costData: true, complianceStatus: true, ...(key.license?.reportingConfig ?? {}) } };
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

    // Keep only what the company allows to be shared (set on its License page). Audit records are never kept.
    const kept: Record<string, unknown> = {};
    for (const part of ['usageMetrics', 'costData', 'complianceStatus'] as const) {
      if (data?.[part] && typeof data[part] === 'object' && result.allowed[part] !== false) kept[part] = data[part];
    }
    const receivedAt = new Date().toISOString();
    const reportId = `rpt_${randomUUID().slice(0, 12)}`;
    await reports().put({
      tenantId, period: `report#${receivedAt}`, reportId, receivedAt,
      agentVersion: typeof agentVersion === 'string' ? agentVersion.slice(0, 40) : null,
      data: kept, ttl: Math.floor(Date.now() / 1000) + REPORT_DAYS * 86400,
    });
    logger.info('Report ingested', { tenantId, agentVersion, reportId, parts: Object.keys(kept) });

    return reply.send({
      accepted: true, reportId, tenantId, receivedAt,
      nextReportExpectedBy: new Date(Date.now() + 600000).toISOString(),
    });
  });

  /** When the company's on-prem install last reported, and what it said. */
  app.get('/reporting/status/:tenantId', { preHandler: [requireAccess(TENANT_READ), requireTenantParam] }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const page = await reports().query({ partition: tenantId, range: { beginsWith: 'report#' }, order: 'desc', limit: 1 });
    const last = page.items[0];
    return reply.send({
      tenantId,
      lastReportAt: last?.receivedAt ?? null,
      agentVersion: last?.agentVersion ?? null,
      lastReport: last?.data ?? null,
      status: !last ? 'awaiting_first_report' : Date.now() - Date.parse(last.receivedAt) > 24 * 3600_000 ? 'stale' : 'reporting',
    });
  });
}
