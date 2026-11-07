import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createLogger } from '@ai-governance/utils';
import { requireAccess, TENANT_ADMIN } from '../auth/guards';
import { DashboardUser, DirectoryError, UserDirectory, userDirectory } from '../services/user-directory';

const logger = createLogger('gateway:users');

/** Roles a company admin can give. Platform admins are made by the operator, never from here. */
const COMPANY_ROLES = ['tenant_admin', 'tenant_auditor', 'tenant_user'] as const;
const name = z.string().trim().min(1).max(80);
const inviteInput = z.object({ email: z.string().trim().toLowerCase().email().max(200), givenName: name, familyName: name, role: z.enum(COMPANY_ROLES) });
const changeInput = z.object({ role: z.enum(COMPANY_ROLES).optional(), enabled: z.boolean().optional() }).refine((c) => c.role !== undefined || c.enabled !== undefined, 'Nothing to change');

const ANY_USER = { roles: ['tenant_admin', 'tenant_auditor', 'tenant_user'] as Array<'tenant_admin' | 'tenant_auditor' | 'tenant_user'> };

/** A company's people: invite by email (Cognito sends the invitation), change roles, disable, remove. */
export async function usersRoutes(app: FastifyInstance, opts: { directory?: UserDirectory } = {}) {
  const dir = () => opts.directory ?? userDirectory();
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof DirectoryError) return reply.status(err.statusCode).send({ error: err.message, code: err.code });
    throw err;
  };
  const me = (request: FastifyRequest) => (request.principal?.kind === 'user' ? request.principal : null);

  /** Who is signed in; also marks an invited person as active. */
  app.get('/me', { preHandler: requireAccess(ANY_USER) }, async (request) => {
    const p = me(request)!;
    if (p.email) await dir().signedIn(request.tenantId, p.email).catch(() => undefined);
    return { userId: p.userId, email: p.email, role: p.role, tenantId: request.tenantId };
  });

  app.get('/users', { preHandler: requireAccess(TENANT_ADMIN) }, async (request) => ({
    managed: dir().real,
    users: (await dir().list(request.tenantId)).sort((a, b) => a.email.localeCompare(b.email)),
  }));

  app.post('/users', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const parsed = inviteInput.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid person', code: 'INVALID_USER' });
    try {
      return reply.status(201).send(await dir().invite({ ...parsed.data, tenantId: request.tenantId }, me(request)?.email ?? request.userId));
    } catch (err) { return fail(reply, err); }
  });

  /** The company's admins can't lock everyone out: someone must stay an active admin. */
  async function wouldLeaveNoAdmin(tenantId: string, target: DashboardUser, after: Partial<DashboardUser>) {
    if (target.role !== 'tenant_admin' || target.status === 'disabled') return false;
    const stillAdmin = (after.role ?? target.role) === 'tenant_admin' && after.status !== 'disabled';
    if (stillAdmin) return false;
    const others = (await dir().list(tenantId)).filter((u) => u.email !== target.email && u.role === 'tenant_admin' && u.status !== 'disabled');
    return others.length === 0;
  }

  const load = async (request: FastifyRequest, reply: FastifyReply) => {
    const email = decodeURIComponent((request.params as { email: string }).email).toLowerCase();
    const user = await dir().get(request.tenantId, email);
    if (!user) { reply.status(404).send({ error: 'No such person in this company', code: 'NOT_FOUND' }); return null; }
    return user;
  };

  app.patch('/users/:email', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const user = await load(request, reply);
    if (!user) return;
    const parsed = changeInput.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid change', code: 'INVALID_USER' });
    const self = me(request)?.email?.toLowerCase() === user.email;
    if (self) return reply.status(409).send({ error: 'You can’t change your own role or turn off your own access', code: 'SELF_CHANGE' });
    const after = { ...(parsed.data.role ? { role: parsed.data.role } : {}), ...(parsed.data.enabled === false ? { status: 'disabled' as const } : {}) };
    if (await wouldLeaveNoAdmin(request.tenantId, user, after)) return reply.status(409).send({ error: 'Keep at least one active admin', code: 'LAST_ADMIN' });
    try {
      let updated = user;
      if (parsed.data.role && parsed.data.role !== user.role) updated = await dir().setRole(updated, parsed.data.role);
      if (parsed.data.enabled !== undefined && parsed.data.enabled !== (user.status !== 'disabled')) updated = await dir().setEnabled(updated, parsed.data.enabled);
      logger.info('User changed', { tenantId: request.tenantId, email: user.email, change: parsed.data, by: me(request)?.email ?? request.userId });
      return updated;
    } catch (err) { return fail(reply, err); }
  });

  app.delete('/users/:email', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const user = await load(request, reply);
    if (!user) return;
    if (me(request)?.email?.toLowerCase() === user.email) return reply.status(409).send({ error: 'You can’t remove yourself', code: 'SELF_CHANGE' });
    if (await wouldLeaveNoAdmin(request.tenantId, user, { status: 'disabled' })) return reply.status(409).send({ error: 'Keep at least one active admin', code: 'LAST_ADMIN' });
    await dir().remove(user);
    logger.info('User removed', { tenantId: request.tenantId, email: user.email, by: me(request)?.email ?? request.userId });
    return { ok: true };
  });

  app.post('/users/:email/resend', { preHandler: requireAccess(TENANT_ADMIN) }, async (request, reply) => {
    const user = await load(request, reply);
    if (!user) return;
    if (user.status !== 'invited') return reply.status(409).send({ error: 'They have already signed in', code: 'ALREADY_ACTIVE' });
    try { await dir().resend(user); return { ok: true }; } catch (err) { return fail(reply, err); }
  });
}
