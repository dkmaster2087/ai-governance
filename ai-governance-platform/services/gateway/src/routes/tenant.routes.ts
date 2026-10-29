import { FastifyInstance } from 'fastify';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, ScanCommand, GetCommand,
  PutCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { createLogger } from '@ai-governance/utils';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { tenantSettings } from '../services/tenant-settings.service';
import { ApiKey, ApiKeyRepository, generateApiKey, LicenseInfo } from '../repositories/api-key.repository';
import { requireAccess, requireTenantParam, PLATFORM_ADMIN, TENANT_ADMIN, TENANT_READ } from '../auth/guards';

const logger = createLogger('gateway:tenants');

const tenantFields = {
  name: z.string().trim().min(1).max(200),
  adminEmail: z.string().trim().email(),
  plan: z.enum(['starter', 'professional', 'enterprise']),
  deploymentMode: z.enum(['saas', 'onprem']),
  region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/, 'must be an AWS region like us-east-1'),
  /** How long evidence is kept; the plan sets it. */
  auditLogRetentionDays: z.number().int().min(30).max(3650),
};
const tenantCreateSchema = z.object({
  ...tenantFields,
  plan: tenantFields.plan.default('starter'),
  deploymentMode: tenantFields.deploymentMode.default('saas'),
  region: tenantFields.region.default('us-east-1'),
  auditLogRetentionDays: tenantFields.auditLogRetentionDays.optional(),
});
const tenantUpdateSchema = z.object(tenantFields).partial();

export async function tenantRoutes(app: FastifyInstance) {
  const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const client = DynamoDBDocumentClient.from(dynamo);
  const table = process.env.TENANTS_TABLE || 'ai-gov-tenants-dev';

  // List all tenants (platform admin only in production)
  app.get('/tenants', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (_request, reply) => {
    try {
      const result = await client.send(new ScanCommand({ TableName: table }));
      return reply.send(result.Items || []);
    } catch (err) {
      logger.error('Failed to list tenants', { error: err });
      return reply.status(500).send({ error: 'Failed to fetch tenants' });
    }
  });

  // Get single tenant
  app.get('/tenants/:tenantId', { preHandler: [requireAccess({ roles: ['tenant_admin', 'tenant_auditor', 'tenant_user'] }), requireTenantParam] }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    try {
      const result = await client.send(new GetCommand({ TableName: table, Key: { tenantId } }));
      if (!result.Item) return reply.status(404).send({ error: 'Tenant not found' });
      return reply.send(result.Item);
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to fetch tenant' });
    }
  });

  // Create / onboard tenant
  app.post('/tenants', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (request, reply) => {
    const body = tenantCreateSchema.parse(request.body);
    const tenant = {
      tenantId: `tenant_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      name: body.name,
      adminEmail: body.adminEmail,
      plan: body.plan ?? 'starter',
      status: 'active',
      deploymentMode: body.deploymentMode ?? 'saas',
      region: body.region ?? 'us-east-1',
      settings: {
        allowedModels: [],
        maxTokensPerRequest: 4096,
        maxRequestsPerMinute: 100,
        dataResidencyRegion: body.region ?? 'us-east-1',
        piiMaskingEnabled: true,
        auditLogRetentionDays: body.auditLogRetentionDays ?? 365,
        allowExternalProviders: false,
        governanceFailMode: 'closed',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await client.send(new PutCommand({ TableName: table, Item: tenant }));
    logger.info('Tenant onboarded', { tenantId: tenant.tenantId, name: tenant.name });
    return reply.status(201).send(tenant);
  });

  // Update tenant
  app.put('/tenants/:tenantId', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const body = tenantUpdateSchema.parse(request.body);
    const updatedAt = new Date().toISOString();

    // Only the fields sent are changed; other settings (fail mode, shadow AI decisions) stay as they are.
    const sets: string[] = ['updatedAt = :updatedAt'];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ':updatedAt': updatedAt };
    for (const key of ['name', 'adminEmail', 'plan', 'deploymentMode', 'region'] as const) {
      if (body[key] === undefined) continue;
      sets.push(`#${key} = :${key}`);
      names[`#${key}`] = key;
      values[`:${key}`] = body[key];
    }
    if (body.auditLogRetentionDays !== undefined) {
      await client.send(new UpdateCommand({
        TableName: table, Key: { tenantId },
        UpdateExpression: 'SET settings = if_not_exists(settings, :empty)', ExpressionAttributeValues: { ':empty': {} },
      }));
      sets.push('settings.auditLogRetentionDays = :retention');
      values[':retention'] = body.auditLogRetentionDays;
    }

    try {
      await client.send(new UpdateCommand({
        TableName: table,
        Key: { tenantId },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'attribute_exists(tenantId)',
        ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
        ExpressionAttributeValues: values,
      }));
    } catch (err) {
      if ((err as Error).name === 'ConditionalCheckFailedException') return reply.status(404).send({ error: 'Tenant not found', code: 'NOT_FOUND' });
      throw err;
    }

    tenantSettings().invalidate(tenantId);
    return reply.send({ tenantId, ...body, updatedAt });
  });

  // Suspend tenant
  app.post('/tenants/:tenantId/suspend', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    await client.send(new UpdateCommand({
      TableName: table,
      Key: { tenantId },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'suspended', ':updatedAt': new Date().toISOString() },
    }));
    tenantSettings().invalidate(tenantId);
    logger.info('Tenant suspended', { tenantId });
    return reply.send({ tenantId, status: 'suspended' });
  });

  // Activate tenant
  app.post('/tenants/:tenantId/activate', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    await client.send(new UpdateCommand({
      TableName: table,
      Key: { tenantId },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'active', ':updatedAt': new Date().toISOString() },
    }));
    tenantSettings().invalidate(tenantId);
    logger.info('Tenant activated', { tenantId });
    return reply.send({ tenantId, status: 'active' });
  });

  // ── Licenses ──────────────────────────────────────────────────────────────
  // A license is a hashed, expiring credential with the 'reporting:ingest' scope (used by the on-prem
  // agent), plus plan details. The raw key is shown once, at issue time.
  const licenseKeys = new ApiKeyRepository();
  const issueLicenseSchema = z.object({
    name: z.string().min(1).max(100).default('License'),
    validityDays: z.number().int().min(1).max(3650).default(365),
    plan: z.enum(['starter', 'professional', 'enterprise']).default('professional'),
    type: z.enum(['cloud', 'onprem']).default('cloud'),
    maxUsers: z.number().int().min(1).max(1_000_000).default(50),
  });
  const reportingSchema = z.object({
    usageMetrics: z.boolean(), costData: z.boolean(), complianceStatus: z.boolean(), auditLogs: z.boolean(),
  });

  const statusOf = (k: ApiKey): 'active' | 'expired' | 'revoked' =>
    k.status === 'revoked' ? 'revoked' : k.expiresAt && new Date(k.expiresAt) < new Date() ? 'expired' : 'active';

  const toView = (k: ApiKey, tenantName?: string) => ({
    licenseId: k.keyId,
    keyPrefix: k.keyPrefix,
    tenantId: k.tenantId,
    tenantName: tenantName ?? k.tenantId,
    status: statusOf(k),
    issuedAt: k.createdAt,
    expiresAt: k.expiresAt,
    lastUsedAt: k.lastUsedAt,
    plan: k.license?.plan ?? 'professional',
    type: k.license?.type ?? 'onprem',
    maxUsers: k.license?.maxUsers ?? 0,
    reportingConfig: k.license?.reportingConfig ?? { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: false },
  });

  const licensesOf = async (tenantId: string) =>
    (await licenseKeys.getForTenant(tenantId)).filter((k) => k.scopes?.includes('reporting:ingest'));

  /** Every license across tenants (platform admins). */
  app.get('/licenses', { preHandler: requireAccess(PLATFORM_ADMIN) }, async () => {
    const result = await client.send(new ScanCommand({ TableName: table, ProjectionExpression: 'tenantId, #n', ExpressionAttributeNames: { '#n': 'name' } }));
    const tenants = (result.Items ?? []) as Array<{ tenantId: string; name?: string }>;
    const lists = await Promise.all(tenants.map(async (t) => (await licensesOf(t.tenantId)).map((k) => toView(k, t.name))));
    return lists.flat().sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  });

  /** The caller's own current license, without the key. */
  app.get('/license', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const all = (await licensesOf(request.tenantId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const current = all.find((k) => statusOf(k) === 'active') ?? all[0];
    if (!current) return reply.status(404).send({ error: 'No license', code: 'NOT_FOUND' });
    const tenant = await client.send(new GetCommand({ TableName: table, Key: { tenantId: request.tenantId } }));
    return toView(current, tenant.Item?.name as string | undefined);
  });

  /** Choose what the on-prem agent may report back (tenant admins). */
  app.put('/license/reporting', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = reportingSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid reporting settings', code: 'INVALID_SETTINGS' });
    const current = (await licensesOf(request.tenantId)).find((k) => statusOf(k) === 'active');
    if (!current) return reply.status(404).send({ error: 'No active license', code: 'NOT_FOUND' });
    const base = toView(current);
    await licenseKeys.setLicenseInfo(request.tenantId, current.keyId, { plan: base.plan, type: base.type, maxUsers: base.maxUsers, reportingConfig: parsed.data });
    return { reportingConfig: parsed.data };
  });

  app.get('/tenants/:tenantId/licenses', { preHandler: [requireAccess({ roles: ['tenant_admin', 'tenant_auditor'] }), requireTenantParam] }, async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    return (await licensesOf(tenantId)).map((k) => toView(k));
  });

  app.post('/tenants/:tenantId/licenses', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const parsed = issueLicenseSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid license', code: 'INVALID_LICENSE' });
    const body = parsed.data;
    const tenant = await client.send(new GetCommand({ TableName: table, Key: { tenantId } }));
    if (!tenant.Item) return reply.status(404).send({ error: 'Tenant not found' });

    const { raw, hash, prefix, keyId } = generateApiKey(tenantId);
    const expiresAt = new Date(Date.now() + body.validityDays * 86400000).toISOString();
    const license: LicenseInfo = {
      plan: body.plan, type: body.type, maxUsers: body.maxUsers,
      reportingConfig: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: false },
    };
    await licenseKeys.create({
      tenantId, keyId, keyHash: hash, keyPrefix: prefix, name: body.name,
      scopes: ['reporting:ingest'], status: 'active', rateLimit: 60,
      createdAt: new Date().toISOString(), expiresAt, createdBy: request.userId, license,
    });
    logger.info('License issued', { tenantId, keyId, expiresAt, plan: body.plan });
    return reply.status(201).send({
      ...toView({ tenantId, keyId, keyHash: hash, keyPrefix: prefix, name: body.name, scopes: ['reporting:ingest'], status: 'active', rateLimit: 60, createdAt: new Date().toISOString(), expiresAt, createdBy: request.userId, license }, tenant.Item.name as string),
      licenseKey: raw,
      message: 'Store this license key securely. It will not be shown again.',
    });
  });

  app.post('/tenants/:tenantId/licenses/:licenseId/revoke', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (request, reply) => {
    const { tenantId, licenseId } = request.params as { tenantId: string; licenseId: string };
    if (!(await licensesOf(tenantId)).some((k) => k.keyId === licenseId)) return reply.status(404).send({ error: 'License not found', code: 'NOT_FOUND' });
    await licenseKeys.revoke(tenantId, licenseId);
    return reply.send({ licenseId, status: 'revoked' });
  });
}
