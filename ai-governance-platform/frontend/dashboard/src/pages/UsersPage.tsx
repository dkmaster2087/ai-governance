import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { changeUser, CompanyUser, inviteUser, listUsers, removeUser, resendInvite } from '../lib/users-api';
import { AUTH_MODE } from '../lib/auth-mode';

/** A customer-run install: no email is sent; the admin gives people a temporary password, shown once. */
const onInstall = AUTH_MODE === 'install';

function TemporaryPassword({ email, password }: { email: string; password: string }) {
  return (
    <div role="status" className="basis-full flex flex-col gap-1.5 bg-canvas border border-line-subtle rounded-lg px-4 py-3">
      <span className="text-sm">Temporary password for {email}. Give it to them yourself; it’s shown only now. They choose their own at first sign-in.</span>
      <code className="font-mono text-[15px] font-semibold select-all">{password}</code>
    </div>
  );
}
import { errorMessage } from '../lib/rules-api';
import { useAuth, getTenantUsers, registerTenantAccount, deleteUserAccount, usersManagedExternally, UserRole, AuthUser } from '../lib/auth';
import { Button, Note, Panel, SectionLabel } from '../components/kit/primitives';

const field = 'w-full min-h-[42px] px-3 border border-line-strong rounded-lg bg-white';

const ROLES: Array<{ role: UserRole; label: string; can: string }> = [
  { role: 'tenant_admin', label: 'Admin', can: 'Everything: rules, keys, models, shadow AI decisions and users.' },
  { role: 'tenant_auditor', label: 'Auditor', can: 'Read-only: Gateway, Stopped, Evidence and Activity. Sees the approvals queue; decides only where named as an approver.' },
  { role: 'tenant_user', label: 'User', can: 'Uses AI through approved apps. No dashboard.' },
];
const roleLabel = (r: string) => ROLES.find((x) => x.role === r)?.label ?? r;

function RoleGuide() {
  return (
    <Panel className="px-6 py-5">
      <SectionLabel className="mb-2">Roles</SectionLabel>
      <dl className="m-0">
        {ROLES.map((r) => (
          <div key={r.role} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-2 border-b border-line-subtle last:border-b-0">
            <dt className="font-semibold">{r.label} <code className="block font-mono text-xs font-normal text-ink-muted">{r.role}</code></dt>
            <dd className="m-0 text-ink-soft">{r.can}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

const COMPANY_ROLES = ROLES.map((r) => r.role);
const STATUS_LABEL: Record<CompanyUser['status'], string> = { invited: 'Invited', active: 'Active', disabled: 'Turned off' };

function PersonRow({ u, me }: { u: CompanyUser; me?: string }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['company-users'] });
  const change = useMutation({ mutationFn: (c: { role?: UserRole; enabled?: boolean }) => changeUser(u.email, c), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => removeUser(u.email), onSuccess: refresh });
  const resend = useMutation({ mutationFn: () => resendInvite(u.email) });
  const isMe = u.email === me?.toLowerCase();
  const error = change.error ?? remove.error ?? resend.error;
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 border-b border-line-subtle last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{u.givenName} {u.familyName}{isMe && <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-ink-tint text-ink">You</span>}</div>
        <div className="text-sm text-ink-muted">{u.email} · <span className={u.status === 'disabled' ? 'text-stop-text font-semibold' : ''}>{STATUS_LABEL[u.status]}</span>
          {u.lastSignInAt ? ` · last signed in ${new Date(u.lastSignInAt).toLocaleDateString()}` : ''}</div>
      </div>
      {isMe ? <span className="text-sm font-semibold w-32">{roleLabel(u.role)}</span> : (
        <select aria-label={`Role for ${u.email}`} className="min-h-[38px] px-2 border border-line-strong rounded-lg bg-white w-32" value={u.role}
          disabled={change.isPending} onChange={(e) => change.mutate({ role: e.target.value as UserRole })}>
          {COMPANY_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
      )}
      {!isMe && (
        <div className="flex gap-2 flex-wrap justify-end">
          {onInstall
            ? u.status !== 'disabled' && <Button variant="ghost" disabled={resend.isPending} onClick={() => resend.mutate()}>New temporary password</Button>
            : u.status === 'invited' && <Button variant="ghost" disabled={resend.isPending} onClick={() => resend.mutate()}>{resend.isSuccess ? 'Sent' : 'Resend invitation'}</Button>}
          <Button variant="ghost" disabled={change.isPending} onClick={() => change.mutate({ enabled: u.status === 'disabled' })}>{u.status === 'disabled' ? 'Turn on' : 'Turn off'}</Button>
          {confirming ? (
            <>
              <Button variant="secondary" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
            </>
          ) : <Button variant="ghost" aria-label={`Remove ${u.email}`} onClick={() => setConfirming(true)}>Remove</Button>}
        </div>
      )}
      {error && <p role="alert" className="basis-full m-0 text-stop-text font-semibold">{errorMessage(error)}</p>}
      {resend.data?.temporaryPassword && <TemporaryPassword email={u.email} password={resend.data.temporaryPassword} />}
      {change.isSuccess && !error && change.variables?.role && (
        <p role="status" className="basis-full m-0 text-sm text-ink-muted">Saved: {u.givenName} is now {roleLabel(change.variables.role)}. It applies the next time they sign in.</p>
      )}
    </li>
  );
}

/** A deployed dashboard: people are invited by email and sign in with Amazon Cognito. */
function CompanyUsers({ tenantName, me }: { tenantName: string; me?: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['company-users'], queryFn: listUsers });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ givenName: '', familyName: '', email: '', role: 'tenant_auditor' as UserRole });
  const invite = useMutation({
    mutationFn: () => inviteUser({ ...form, email: form.email.trim(), givenName: form.givenName.trim(), familyName: form.familyName.trim() }),
    onSuccess: (made) => {
      setGiven(made.temporaryPassword ? { email: made.email, password: made.temporaryPassword } : null);
      setForm({ givenName: '', familyName: '', email: '', role: 'tenant_auditor' }); setAdding(false); qc.invalidateQueries({ queryKey: ['company-users'] });
    },
  });
  const [given, setGiven] = useState<{ email: string; password: string } | null>(null);
  const ready = form.givenName.trim() && form.familyName.trim() && form.email.trim() && !invite.isPending;
  const people = data?.users ?? [];
  return (
    <div className="flex flex-col gap-6 max-w-[1000px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <p className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-0.02em]">{data ? `${people.length} ${people.length === 1 ? 'person' : 'people'} can sign in to ${tenantName}.` : 'People'}</p>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px]">
            {onInstall
              ? 'People you add get a temporary password, shown to you once to pass on, and choose their own the first time they sign in. With company sign-in set up, they can use that instead.'
              : 'People you add get an email invitation with a temporary password, and choose their own the first time they sign in.'}
          </p>
        </div>
        {!adding && <Button onClick={() => setAdding(true)}>{onInstall ? 'Add someone' : 'Invite someone'}</Button>}
      </div>
      {adding && (
        <Panel aria-label="Invite someone" className="px-6 py-5">
          <SectionLabel className="mb-3">Invite someone</SectionLabel>
          <form className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} onSubmit={(e) => { e.preventDefault(); if (ready) invite.mutate(); }}>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">First name</span>
              <input className={field} value={form.givenName} onChange={(e) => setForm({ ...form, givenName: e.target.value })} /></label>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Last name</span>
              <input className={field} value={form.familyName} onChange={(e) => setForm({ ...form, familyName: e.target.value })} /></label>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Email</span>
              <input className={field} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" /></label>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Role</span>
              <select className={field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
                {ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
              </select></label>
            {invite.isError && <p role="alert" className="m-0 col-span-full text-stop-text font-semibold">{errorMessage(invite.error)}</p>}
            <div className="flex gap-2 col-span-full">
              <Button type="submit" disabled={!ready}>{invite.isPending ? 'Adding…' : onInstall ? 'Add' : 'Send invitation'}</Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </form>
        </Panel>
      )}
      {given && <Panel className="px-6 py-4 flex flex-wrap"><TemporaryPassword email={given.email} password={given.password} /></Panel>}
      {isError && <Panel className="px-6"><Note title="Couldn’t load people."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}
      {data && people.length === 0 && <Panel className="px-6"><Note title="No one yet." /></Panel>}
      {people.length > 0 && <Panel><ul className="m-0 p-0 list-none">{people.map((u) => <PersonRow key={u.email} u={u} me={me} />)}</ul></Panel>}
      <RoleGuide />
    </div>
  );
}

/** Local development: demo accounts kept in this browser. */
function DemoAccounts({ tenantId, tenantName, me }: { tenantId: string; tenantName: string; me?: string }) {
  const [, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'tenant_user' as UserRole });
  const users: AuthUser[] = getTenantUsers(tenantId);

  const add = () => {
    registerTenantAccount({ ...form, password: form.password || 'welcome123', tenantId, tenantName });
    setForm({ name: '', email: '', password: '', role: 'tenant_user' });
    setAdding(false);
    refresh();
  };

  return (
    <div className="flex flex-col gap-6 max-w-[1000px]">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <p className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-0.02em]">{users.length} {users.length === 1 ? 'person' : 'people'} can sign in to {tenantName}.</p>
          <p className="m-0 mt-1.5 text-ink-muted text-[15px]">Local demo accounts, kept in this browser. Deployed dashboards use Amazon Cognito instead.</p>
        </div>
        {!adding && <Button onClick={() => setAdding(true)}>Add someone</Button>}
      </div>

      {adding && (
        <Panel aria-label="Add someone" className="px-6 py-5">
          <SectionLabel className="mb-3">Add someone</SectionLabel>
          <form className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
            onSubmit={(e) => { e.preventDefault(); if (form.name.trim() && form.email.trim()) add(); }}>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Name</span>
              <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Smith" />
            </label>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Email</span>
              <input className={field} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" />
            </label>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Password</span>
              <input className={field} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Default: welcome123" />
            </label>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Role</span>
              <select className={field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
                {ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
              </select>
            </label>
            <div className="flex gap-2 col-span-full">
              <Button type="submit" disabled={!form.name.trim() || !form.email.trim()}>Add</Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </form>
        </Panel>
      )}

      {users.length === 0 ? <Panel className="px-6"><Note title="No one yet." /></Panel> : (
        <Panel>
          <ul className="m-0 p-0 list-none">
            {users.map((u) => {
              const isMe = u.email === me;
              return (
                <li key={u.email} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 border-b border-line-subtle last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{u.name}{isMe && <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-ink-tint text-ink">You</span>}</div>
                    <div className="text-sm text-ink-muted">{u.email}</div>
                  </div>
                  <span className="text-sm font-semibold w-20">{roleLabel(u.role)}</span>
                  <div className="flex gap-2 min-w-[150px] justify-end">
                    {isMe || u.role === 'platform_admin' ? null : confirming === u.email ? (
                      <>
                        <Button variant="secondary" onClick={() => { deleteUserAccount(u.email); setConfirming(null); refresh(); }}>Remove</Button>
                        <Button variant="ghost" onClick={() => setConfirming(null)}>Keep</Button>
                      </>
                    ) : (
                      <Button variant="ghost" aria-label={`Remove ${u.name}`} onClick={() => setConfirming(u.email)}>Remove</Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
      <RoleGuide />
    </div>
  );
}

/** Who can sign in, and with which role. */
export function UsersPage() {
  const { user } = useAuth();
  const tenantId = user?.tenantId || '';
  const tenantName = user?.tenantName || '';
  return usersManagedExternally
    ? <CompanyUsers tenantName={tenantName} me={user?.email} />
    : <DemoAccounts tenantId={tenantId} tenantName={tenantName} me={user?.email} />;
}
