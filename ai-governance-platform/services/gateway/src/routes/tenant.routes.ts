import { FastifyInstance } from 'fastify';
import { allPages, collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import { tenantSettings } from '../services/tenant-settings.service';
import { userDirectory } from '../services/user-directory';
import { LicenseClaims, LicenseFileError, licenseSignerFromEnv, signLicenseFile } from '../licensing/license-file';
import { offlineLicense, offlineLicensing } from '../licensing/offline-license';
import { ApiKeyRepository, generateApiKey, hashApiKey, LicenseInfo } from '../repositories/api-key.repository';
import { GRACE_DAYS, LicenseKey, licenseState } from '../services/license-state';
import { forgetApiKey } from '../middleware/auth.middleware';
import { requireAccess, requireTenantParam, PLATFORM_ADMIN, TENANT_ADMIN, TENANT_READ } from '../auth/guards';
import { reapplyRetention } from '../services/retention';

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
  /** The first admin's name, for their invitation (taken from the email when not given). */
  adminGivenName: z.string().trim().min(1).max(80).optional(),
  adminFamilyName: z.string().trim().min(1).max(80).optional(),
  plan: tenantFields.plan.default('starter'),
  deploymentMode: tenantFields.deploymentMode.default('saas'),
  region: tenantFields.region.default('us-east-1'),
  auditLogRetentionDays: tenantFields.auditLogRetentionDays.optional(),
});
const tenantUpdateSchema = z.object(tenantFields).partial();

export async function tenantRoutes(app: FastifyInstance) {
  const tenants = () => collection('tenants');
  const allTenants = () => allPages((after) => tenants().scan({ after, limit: 1000 }));

  // List all tenants (platform admin only in production)
  app.get('/tenants', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (_request, reply) => {
    try {
      return reply.send(await allTenants());
    } catch (err) {
      logger.error('Failed to list tenants', { error: err });
      return reply.status(500).send({ error: 'Failed to fetch tenants' });
    }
  });

  // Get single tenant
  app.get('/tenants/:tenantId', { preHandler: [requireAccess({ roles: ['tenant_admin', 'tenant_auditor', 'tenant_user'] }), requireTenantParam] }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    try {
      const tenant = await tenants().get({ tenantId });
      if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });
      return reply.send(tenant);
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
        auditLogRetentionDays: body.auditLogRetentionDays ?? 365,
        governanceFailMode: 'closed',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await tenants().put(tenant);
    logger.info('Tenant onboarded', { tenantId: tenant.tenantId, name: tenant.name });

    // Invite the company's first admin, so someone can sign in.
    const local = body.adminEmail.split('@')[0].replace(/[._-]+/g, ' ').trim();
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const [first, ...rest] = local.split(' ');
    let adminInvite: { status: 'sent' | 'recorded' | 'failed'; error?: string };
    try {
      await userDirectory().invite({
        tenantId: tenant.tenantId, email: body.adminEmail, role: 'tenant_admin',
        givenName: body.adminGivenName ?? cap(first || 'Admin'), familyName: body.adminFamilyName ?? (cap(rest.join(' ')) || tenant.name),
      }, request.userId);
      adminInvite = { status: userDirectory().real ? 'sent' : 'recorded' };
    } catch (err) {
      logger.error('Could not invite the first admin', { tenantId: tenant.tenantId, error: (err as Error).message });
      adminInvite = { status: 'failed', error: (err as Error).message };
    }
    return reply.status(201).send({ ...tenant, adminInvite });
  });

  // Update tenant
  app.put('/tenants/:tenantId', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const body = tenantUpdateSchema.parse(request.body);
    const updatedAt = new Date().toISOString();

    // Only the fields sent are changed; other settings (fail mode, shadow AI decisions) stay as they are.
    const set: Record<string, unknown> = { updatedAt };
    for (const key of ['name', 'adminEmail', 'plan', 'deploymentMode', 'region'] as const) {
      if (body[key] !== undefined) set[key] = body[key];
    }
    if (body.auditLogRetentionDays !== undefined) set['settings.auditLogRetentionDays'] = body.auditLogRetentionDays;
    const updated = await tenants().update({ tenantId }, { set, ifExists: true });
    if (!updated) return reply.status(404).send({ error: 'Tenant not found', code: 'NOT_FOUND' });

    tenantSettings().invalidate(tenantId);
    if (body.auditLogRetentionDays !== undefined) {
      // Re-date the company's existing records in the background; new ones use the new period at once.
      reapplyRetention(tenantId).catch((err) => logger.error('Could not apply the new retention period', { tenantId, error: (err as Error).message }));
    }
    return reply.send({ tenantId, ...body, updatedAt });
  });

  // Legal hold: while on, nothing of the company's evidence is deleted. Its own admins can set it.
  app.put('/tenants/:tenantId/legal-hold', { preHandler: [requireAccess(TENANT_ADMIN), requireTenantParam] }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const parsed = z.object({ on: z.boolean(), reason: z.string().trim().max(300).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Send on (true or false) and a reason', code: 'INVALID_HOLD' });
    if (parsed.data.on && !parsed.data.reason) return reply.status(400).send({ error: 'Say why evidence is being held (for example the matter or case)', code: 'REASON_REQUIRED' });
    const by = request.principal?.kind === 'user' ? request.principal.email ?? request.userId : request.userId;
    const legalHold = { on: parsed.data.on, since: new Date().toISOString(), by, reason: parsed.data.reason ?? '' };
    const updated = await tenants().update({ tenantId }, { set: { 'settings.legalHold': legalHold, updatedAt: legalHold.since }, ifExists: true });
    if (!updated) return reply.status(404).send({ error: 'Tenant not found', code: 'NOT_FOUND' });
    logger.info(parsed.data.on ? 'Legal hold placed' : 'Legal hold released', { tenantId, by, reason: legalHold.reason });
    reapplyRetention(tenantId).catch((err) => logger.error('Could not apply the legal hold to existing records', { tenantId, error: (err as Error).message }));
    return reply.send({ legalHold });
  });

  // Suspend tenant
  app.post('/tenants/:tenantId/suspend', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const updated = await tenants().update({ tenantId }, { set: { status: 'suspended', updatedAt: new Date().toISOString() }, ifExists: true });
    if (!updated) return reply.status(404).send({ error: 'Tenant not found', code: 'NOT_FOUND' });
    tenantSettings().invalidate(tenantId);
    logger.info('Tenant suspended', { tenantId });
    return reply.send({ tenantId, status: 'suspended' });
  });

  // Activate tenant
  app.post('/tenants/:tenantId/activate', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const updated = await tenants().update({ tenantId }, { set: { status: 'active', updatedAt: new Date().toISOString() }, ifExists: true });
    if (!updated) return reply.status(404).send({ error: 'Tenant not found', code: 'NOT_FOUND' });
    tenantSettings().invalidate(tenantId);
    logger.info('Tenant activated', { tenantId });
    return reply.send({ tenantId, status: 'active' });
  });

  // ── Licenses ──────────────────────────────────────────────────────────────
  // A license is a hashed, expiring key with the 'reporting:ingest' scope (also used by the on-prem agent),
  // plus plan details. The platform issues it for one company; it counts once that company's admin enters
  // the key on their License page. The raw key is shown once, at issue time.
  const licenseKeys = new ApiKeyRepository();
  const licenseRecords = () => collection<LicenseKey>('apiKeys');
  const issueLicenseSchema = z.object({
    name: z.string().min(1).max(100).default('License'),
    validityDays: z.number().int().min(1).max(3650).default(365),
    plan: z.enum(['starter', 'professional', 'enterprise']).default('professional'),
    type: z.enum(['cloud', 'onprem']).default('cloud'),
    /** Customer-run (onprem) only: the gateway's hostname(s), e.g. ai-gateway.customer.com. One gateway; at most 3 names. */
    addresses: z.array(z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/, 'A hostname such as ai-gateway.customer.com')).min(1).max(3).optional(),
  }).refine((b) => b.type !== 'onprem' || (b.addresses?.length ?? 0) > 0, { message: 'A customer-run license needs the gateway’s address', path: ['addresses'] });
  const revokeSchema = z.object({ graceDays: z.number().int().min(0).max(90).optional() });
  const activateSchema = z.object({ licenseKey: z.string().trim().min(10).max(200) });

  type LicenseStatusLabel = 'pending' | 'active' | 'expired' | 'revoked' | 'removed';
  const statusOf = (k: LicenseKey): LicenseStatusLabel =>
    k.status === 'revoked' ? 'revoked'
      : k.activation === 'removed' ? 'removed'
      : k.expiresAt && new Date(k.expiresAt) < new Date() ? 'expired'
      : k.activation === 'pending' ? 'pending' : 'active';

  const toView = (k: LicenseKey, tenantName?: string) => ({
    licenseId: k.keyId,
    keyPrefix: k.keyPrefix,
    tenantId: k.tenantId,
    tenantName: tenantName ?? k.tenantId,
    status: statusOf(k),
    issuedAt: k.createdAt,
    expiresAt: k.expiresAt,
    lastUsedAt: k.lastUsedAt,
    ...(k.activatedAt ? { activatedAt: k.activatedAt } : {}),
    ...(k.revokedAt ? { revokedAt: k.revokedAt } : {}),
    ...(k.removedAt ? { removedAt: k.removedAt } : {}),
    ...(k.graceUntil ? { graceUntil: k.graceUntil } : {}),
    plan: k.license?.plan ?? 'professional',
    type: k.license?.type ?? 'onprem',
  });

  /** A license file, as the License pages show it. */
  const fileLicenseView = (c: LicenseClaims, activatedAt?: string) => ({
    licenseId: c.id,
    keyPrefix: c.id,
    tenantId: c.tenantId,
    tenantName: c.customer,
    status: Date.parse(c.endsAt) <= Date.now() ? 'expired' as const : 'active' as const,
    issuedAt: c.issuedAt,
    expiresAt: c.endsAt,
    ...(activatedAt ? { activatedAt } : {}),
    plan: c.plan,
    type: 'onprem' as const,
    addresses: c.addresses,
  });

  /** License files we issued for customer-run installs: our records only; they don't affect the company's Cloud license. */
  const FILE_SCOPE = 'license:file';
  const fileLicensesOf = async (tenantId: string) =>
    (await licenseKeys.getForTenant(tenantId)).filter((k) => k.scopes?.includes(FILE_SCOPE)) as Array<LicenseKey & { addresses?: string[]; licenseFile?: string }>;

  const licensesOf = async (tenantId: string) =>
    (await licenseKeys.getForTenant(tenantId)).filter((k) => k.scopes?.includes('reporting:ingest')) as LicenseKey[];
  const changed = (tenantId: string) => licenseState().invalidate(tenantId);

  /** Every license across tenants (platform admins). */
  app.get('/licenses', { preHandler: requireAccess(PLATFORM_ADMIN) }, async () => {
    const list = (await allTenants()) as Array<{ tenantId: string; name?: string }>;
    const lists = await Promise.all(list.map(async (t) => [
      ...(await licensesOf(t.tenantId)).map((k) => toView(k, t.name)),
      ...(await fileLicensesOf(t.tenantId)).map((k) => ({ ...toView(k, t.name), addresses: k.addresses ?? [], file: true })),
    ]));
    return lists.flat().sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  });

  /** Where the caller's company stands: for the banner every dashboard page shows. */
  app.get('/license/status', { preHandler: requireAccess({ roles: ['tenant_admin', 'tenant_auditor', 'tenant_user'] }) }, async (request) =>
    (await licenseState().get(request.tenantId)) ?? { state: 'active' });

  /** The company's licenses (entered ones; issued keys not yet entered stay hidden) and where it stands. */
  app.get('/license/overview', { preHandler: requireAccess(TENANT_READ) }, async (request) => {
    if (offlineLicensing()) {
      const current = await offlineLicense().current();
      return {
        status: (await licenseState().get(request.tenantId)) ?? { state: 'active' },
        licenses: current ? [fileLicenseView(current.claims, current.installedAt)] : [],
        offline: true,
      };
    }
    const tenant = await tenants().get({ tenantId: request.tenantId });
    const all = (await licensesOf(request.tenantId)).filter((k) => k.activation !== 'pending').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      status: (await licenseState().get(request.tenantId)) ?? { state: 'active' },
      licenses: all.map((k) => toView(k, tenant?.name as string | undefined)),
    };
  });

  /** The caller's own current license, without the key (older dashboards). */
  app.get('/license', { preHandler: requireAccess(TENANT_READ) }, async (request, reply) => {
    const all = (await licensesOf(request.tenantId)).filter((k) => k.activation !== 'pending').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const current = all.find((k) => statusOf(k) === 'active') ?? all[0];
    if (!current) return reply.status(404).send({ error: 'No license', code: 'NOT_FOUND' });
    const tenant = await tenants().get({ tenantId: request.tenantId });
    return toView(current, tenant?.name as string | undefined);
  });

  /** A company admin enters the key their provider sent. It must be this company's, and still valid. */
  app.post('/license/activate', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    // A customer-run install: the license is a signed file, checked here and kept in this install's database.
    if (offlineLicensing()) {
      const text = String((request.body as { licenseKey?: unknown })?.licenseKey ?? '').trim();
      if (!text || text.length > 8000) return reply.status(400).send({ error: 'Paste the license file Probaline sent', code: 'INVALID_LICENSE_KEY' });
      try {
        const installed = await offlineLicense().install(text, request.userId);
        return { license: fileLicenseView(installed.claims, installed.installedAt), status: await licenseState().get(request.tenantId) };
      } catch (err) {
        if (err instanceof LicenseFileError) return reply.status(400).send({ error: err.message, code: `LICENSE_${err.code}` });
        throw err;
      }
    }
    const parsed = activateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Enter the license key your provider sent', code: 'INVALID_LICENSE_KEY' });
    const found = (await licenseKeys.findByHash(hashApiKey(parsed.data.licenseKey))) as LicenseKey | null;
    const refuse = (error: string, code: string, status = 400) => {
      logger.info('License key refused', { tenantId: request.tenantId, code, by: request.userId });
      return reply.status(status).send({ error, code });
    };
    if (!found || !found.scopes?.includes('reporting:ingest')) return refuse('That isn’t a valid license key. Check it was copied in full.', 'INVALID_LICENSE_KEY');
    if (found.tenantId !== request.tenantId) return refuse('That license key was issued for another company.', 'LICENSE_FOR_ANOTHER_COMPANY', 403);
    if (found.status === 'revoked') return refuse('That license key has been revoked. Ask your provider for a new one.', 'LICENSE_REVOKED');
    if (found.expiresAt && Date.parse(found.expiresAt) <= Date.now()) return refuse('That license key has expired. Ask your provider for a new one.', 'LICENSE_EXPIRED');
    if (found.activation === 'active' || found.activation === undefined) return refuse('That license is already on your account.', 'LICENSE_ALREADY_ACTIVE', 409);
    const updated = await licenseRecords().update({ tenantId: found.tenantId, keyId: found.keyId }, {
      set: { activation: 'active', activatedAt: new Date().toISOString(), activatedBy: request.userId }, remove: ['removedAt'], ifExists: true,
    });
    changed(request.tenantId);
    logger.info('License activated', { tenantId: request.tenantId, licenseId: found.keyId, by: request.userId });
    const tenant = await tenants().get({ tenantId: request.tenantId });
    return { license: toView(updated!, tenant?.name as string | undefined), status: await licenseState().get(request.tenantId) };
  });

  /** A company admin takes a license off their account. With no other license, the grace period starts. */
  app.post('/license/:licenseId/remove', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    if (offlineLicensing()) return reply.status(409).send({ error: 'Enter a new license file to replace this one', code: 'NOT_SUPPORTED' });
    const { licenseId } = request.params as { licenseId: string };
    const k = (await licensesOf(request.tenantId)).find((x) => x.keyId === licenseId);
    if (!k || k.activation === 'pending') return reply.status(404).send({ error: 'License not found', code: 'NOT_FOUND' });
    if (k.activation === 'removed') return reply.status(409).send({ error: 'That license was already removed', code: 'ALREADY_REMOVED' });
    await licenseRecords().update({ tenantId: request.tenantId, keyId: licenseId }, { set: { activation: 'removed', removedAt: new Date().toISOString(), removedBy: request.userId }, ifExists: true });
    changed(request.tenantId);
    logger.info('License removed by the company', { tenantId: request.tenantId, licenseId, by: request.userId });
    return { licenseId, status: 'removed', license: await licenseState().get(request.tenantId) };
  });

  app.get('/tenants/:tenantId/licenses', { preHandler: [requireAccess({ roles: ['tenant_admin', 'tenant_auditor'] }), requireTenantParam] }, async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    return (await licensesOf(tenantId)).map((k) => toView(k));
  });

  /** Issue a license for one company. It counts once the company enters the key. */
  app.post('/tenants/:tenantId/licenses', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const parsed = issueLicenseSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid license', code: 'INVALID_LICENSE' });
    const body = parsed.data;
    const tenant = await tenants().get({ tenantId });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });

    // Customer-run: a signed file the gateway checks by itself. We keep a copy for our records and re-download.
    if (body.type === 'onprem') {
      const signer = licenseSignerFromEnv();
      if (!signer) return reply.status(503).send({ error: 'This deployment has no license-signing key, so it can’t issue license files', code: 'NO_SIGNING_KEY' });
      const id = `lic_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const issuedAt = new Date().toISOString();
      const endsAt = new Date(Date.now() + body.validityDays * 86400000).toISOString();
      const licenseFile = await signLicenseFile({
        id, customer: String(tenant.name ?? tenantId), tenantId, plan: body.plan, addresses: body.addresses!, issuedAt, endsAt,
      }, signer);
      const record = {
        tenantId, keyId: id, keyHash: createHash('sha256').update(licenseFile).digest('hex'), keyPrefix: id, name: body.name,
        scopes: [FILE_SCOPE], status: 'active', rateLimit: 0, createdAt: issuedAt, expiresAt: endsAt, createdBy: request.userId,
        license: { plan: body.plan, type: 'onprem' }, addresses: body.addresses, licenseFile, activation: 'active',
      } as unknown as LicenseKey;
      await licenseRecords().put(record);
      logger.info('License file issued', { tenantId, licenseId: id, endsAt, addresses: body.addresses, by: request.userId });
      return reply.status(201).send({
        ...toView(record, tenant.name as string), addresses: body.addresses, file: true, licenseFile,
        message: 'Send this file to the company. They enter it on their gateway’s License page, or set it in PROBALINE_LICENSE when installing. Their gateway checks it by itself and serves only the address it names.',
      });
    }

    const { raw, hash, prefix, keyId } = generateApiKey(tenantId);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + body.validityDays * 86400000).toISOString();
    const license: LicenseInfo = { plan: body.plan, type: body.type };
    const record: LicenseKey = {
      tenantId, keyId, keyHash: hash, keyPrefix: prefix, name: body.name,
      scopes: ['reporting:ingest'], status: 'active', rateLimit: 60,
      createdAt: now, expiresAt, createdBy: request.userId, license, activation: 'pending',
    };
    await licenseRecords().put(record);
    logger.info('License issued', { tenantId, keyId, expiresAt, plan: body.plan });
    return reply.status(201).send({
      ...toView(record, tenant.name as string),
      licenseKey: raw,
      message: 'Send this key to the company. It counts once one of their admins enters it on their License page. It will not be shown again.',
    });
  });

  /** Download a license file again (platform admins): it's signed, not secret, and only works at its address. */
  app.get('/tenants/:tenantId/licenses/:licenseId/file', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (request, reply) => {
    const { tenantId, licenseId } = request.params as { tenantId: string; licenseId: string };
    const k = (await fileLicensesOf(tenantId)).find((x) => x.keyId === licenseId);
    if (!k?.licenseFile) return reply.status(404).send({ error: 'License file not found', code: 'NOT_FOUND' });
    return { licenseId, licenseFile: k.licenseFile };
  });

  /** End a license. The company keeps working through a grace period (default 30 days; 0 stops it at once). */
  app.post('/tenants/:tenantId/licenses/:licenseId/revoke', { preHandler: requireAccess(PLATFORM_ADMIN) }, async (request, reply) => {
    const { tenantId, licenseId } = request.params as { tenantId: string; licenseId: string };
    const parsed = revokeSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'graceDays must be 0 to 90', code: 'INVALID_GRACE' });
    const file = (await fileLicensesOf(tenantId)).find((k) => k.keyId === licenseId);
    if (file) return reply.status(409).send({ error: `A license file can’t be revoked: the customer’s gateway never contacts us. It ends on ${file.expiresAt?.slice(0, 10)}.`, code: 'FILE_LICENSE' });
    if (!(await licensesOf(tenantId)).some((k) => k.keyId === licenseId)) return reply.status(404).send({ error: 'License not found', code: 'NOT_FOUND' });
    const now = new Date();
    const graceDays = parsed.data.graceDays ?? GRACE_DAYS();
    const graceUntil = new Date(now.getTime() + graceDays * 86_400_000).toISOString();
    await licenseRecords().update({ tenantId, keyId: licenseId }, { set: { status: 'revoked', revokedAt: now.toISOString(), graceUntil, revokedBy: request.userId }, ifExists: true });
    forgetApiKey(licenseId);
    changed(tenantId);
    logger.info('License revoked', { tenantId, licenseId, graceUntil, by: request.userId });
    return reply.send({ licenseId, status: 'revoked', graceUntil });
  });
}
