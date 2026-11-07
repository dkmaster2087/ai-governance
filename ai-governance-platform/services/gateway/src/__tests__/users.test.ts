import Fastify, { FastifyInstance } from 'fastify';
import { collection, MemoryStore, setRecords } from '@ai-governance/storage';
import { DirectoryError, SignInAccounts, UserDirectory, setUserDirectory } from '../services/user-directory';

/** Sign-in accounts that record what Cognito would have been asked to do. */
class FakeAccounts implements SignInAccounts {
  readonly real = true;
  calls: string[] = [];
  existing = new Set<string>();
  async invite(u: { email: string; role: string; tenantId: string }, resend = false) {
    if (!resend && this.existing.has(u.email)) throw new DirectoryError('Someone with that email already has a Probaline account', 'USER_EXISTS', 409);
    this.existing.add(u.email);
    this.calls.push(`${resend ? 'resend' : 'invite'} ${u.email} ${resend ? '' : `${u.tenantId} ${u.role}`}`.trim());
  }
  async setRole(email: string, role: string) { this.calls.push(`role ${email} ${role}`); }
  async setEnabled(email: string, enabled: boolean) { this.calls.push(`${enabled ? 'enable' : 'disable'} ${email}`); }
  async remove(email: string) { this.calls.push(`remove ${email}`); }
}

describe('company users', () => {
  let accounts: FakeAccounts;
  beforeEach(() => {
    setRecords(new MemoryStore());
    accounts = new FakeAccounts();
    setUserDirectory(new UserDirectory(accounts));
  });
  afterAll(() => setUserDirectory(null));

  async function appAs(role: string, email = 'boss@acme.example', tenantId = 'tenant_acme'): Promise<FastifyInstance> {
    const { usersRoutes } = await import('../routes/users.routes');
    const { tenantRoutes } = await import('../routes/tenant.routes');
    const app = Fastify();
    app.decorateRequest('principal', null);
    app.addHook('preHandler', async (req: any) => {
      req.principal = { kind: 'user', homeTenantId: tenantId, userId: `sub-${email}`, email, role };
      req.tenantId = tenantId;
      req.userId = req.principal.userId;
    });
    await app.register(usersRoutes, { prefix: '/v1' });
    await app.register(tenantRoutes, { prefix: '/v1' });
    return app;
  }
  const invite = (app: FastifyInstance, email: string, role = 'tenant_auditor') =>
    app.inject({ method: 'POST', url: '/v1/users', payload: { email, givenName: 'Jane', familyName: 'Doe', role } });

  it('creating a company invites its first admin', async () => {
    const platform = await appAs('platform_admin', 'ops@probaline.example', 'tenant_platform');
    const res = await platform.inject({ method: 'POST', url: '/v1/tenants', payload: { name: 'Acme', adminEmail: 'Mary.Smith@acme.example', plan: 'starter' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().adminInvite).toEqual({ status: 'sent' });
    const tenantId = res.json().tenantId;
    expect(accounts.calls).toEqual([`invite mary.smith@acme.example ${tenantId} tenant_admin`]);
    expect(await collection('users').get({ tenantId, email: 'mary.smith@acme.example' })).toMatchObject({ givenName: 'Mary', familyName: 'Smith', role: 'tenant_admin', status: 'invited' });
  });

  it('lets a company admin invite people, change their role, turn them off and remove them', async () => {
    await collection('users').put({ tenantId: 'tenant_acme', email: 'boss@acme.example', role: 'tenant_admin', status: 'active', givenName: 'B', familyName: 'O' });
    const admin = await appAs('tenant_admin');
    const made = await invite(admin, 'Jane@Acme.example');
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ email: 'jane@acme.example', role: 'tenant_auditor', status: 'invited', invitedBy: 'boss@acme.example' });
    expect((await invite(admin, 'jane@acme.example')).json().code).toBe('USER_EXISTS');
    expect((await admin.inject({ method: 'GET', url: '/v1/users' })).json()).toMatchObject({ managed: true, users: [{ email: 'boss@acme.example' }, { email: 'jane@acme.example' }] });

    expect((await admin.inject({ method: 'POST', url: '/v1/users/jane%40acme.example/resend' })).json()).toEqual({ ok: true });
    expect((await admin.inject({ method: 'PATCH', url: '/v1/users/jane@acme.example', payload: { role: 'tenant_admin' } })).json()).toMatchObject({ role: 'tenant_admin' });
    expect((await admin.inject({ method: 'PATCH', url: '/v1/users/jane@acme.example', payload: { enabled: false } })).json()).toMatchObject({ status: 'disabled' });
    expect((await admin.inject({ method: 'DELETE', url: '/v1/users/jane@acme.example' })).json()).toEqual({ ok: true });
    expect(accounts.calls).toEqual([
      'invite jane@acme.example tenant_acme tenant_auditor', 'resend jane@acme.example', 'role jane@acme.example tenant_admin',
      'disable jane@acme.example', 'remove jane@acme.example',
    ]);
  });

  it('never leaves a company without an active admin, and nobody changes or removes themselves', async () => {
    await collection('users').put({ tenantId: 'tenant_acme', email: 'boss@acme.example', role: 'tenant_admin', status: 'active', givenName: 'B', familyName: 'O' });
    await collection('users').put({ tenantId: 'tenant_acme', email: 'other@acme.example', role: 'tenant_admin', status: 'active', givenName: 'O', familyName: 'T' });
    const admin = await appAs('tenant_admin');
    expect((await admin.inject({ method: 'PATCH', url: '/v1/users/boss@acme.example', payload: { role: 'tenant_auditor' } })).json().code).toBe('SELF_CHANGE');
    expect((await admin.inject({ method: 'DELETE', url: '/v1/users/boss@acme.example' })).json().code).toBe('SELF_CHANGE');
    // Another admin can demote boss... but not the last admin.
    const other = await appAs('tenant_admin', 'other@acme.example');
    expect((await other.inject({ method: 'PATCH', url: '/v1/users/boss@acme.example', payload: { role: 'tenant_auditor' } })).statusCode).toBe(200);
    const boss = await appAs('tenant_admin');
    expect((await boss.inject({ method: 'PATCH', url: '/v1/users/other@acme.example', payload: { enabled: false } })).json().code).toBe('LAST_ADMIN');
  });

  it('keeps companies apart, gives only company roles, and only admins manage people', async () => {
    const admin = await appAs('tenant_admin');
    await invite(admin, 'jane@acme.example');
    const otherCompany = await appAs('tenant_admin', 'x@other.example', 'tenant_other');
    expect((await otherCompany.inject({ method: 'GET', url: '/v1/users' })).json().users).toEqual([]);
    expect((await otherCompany.inject({ method: 'DELETE', url: '/v1/users/jane@acme.example' })).statusCode).toBe(404);
    expect((await invite(admin, 'evil@acme.example', 'platform_admin')).statusCode).toBe(400);
    expect((await (await appAs('tenant_auditor')).inject({ method: 'GET', url: '/v1/users' })).statusCode).toBe(403);
  });

  it('marks an invited person active once they sign in', async () => {
    const admin = await appAs('tenant_admin');
    await invite(admin, 'jane@acme.example');
    const jane = await appAs('tenant_auditor', 'jane@acme.example');
    expect((await jane.inject({ method: 'GET', url: '/v1/me' })).json()).toMatchObject({ email: 'jane@acme.example', role: 'tenant_auditor', tenantId: 'tenant_acme' });
    expect(await collection('users').get({ tenantId: 'tenant_acme', email: 'jane@acme.example' })).toMatchObject({ status: 'active', lastSignInAt: expect.any(String) });
  });
});
