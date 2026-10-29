import { useState } from 'react';
import { useAuth, getTenantUsers, registerTenantAccount, deleteUserAccount, usersManagedExternally, UserRole, AuthUser } from '../lib/auth';
import { Button, Note, Panel, SectionLabel } from '../components/aegis/primitives';

const field = 'w-full min-h-[42px] px-3 border border-line-strong rounded-lg bg-white';

const ROLES: Array<{ role: UserRole; label: string; can: string }> = [
  { role: 'tenant_admin', label: 'Admin', can: 'Everything: rules, keys, models, shadow AI decisions and users.' },
  { role: 'tenant_auditor', label: 'Auditor', can: 'Read-only: Gateway, Stopped and Evidence.' },
  { role: 'tenant_user', label: 'User', can: 'Uses AI through approved apps. No dashboard.' },
];
const roleLabel = (r: string) => ROLES.find((x) => x.role === r)?.label ?? r;

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="m-0 bg-canvas border border-line-subtle rounded-lg px-4 py-3 pr-20 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</pre>
      <button type="button" className="absolute top-2 right-2 min-h-[32px] px-3 rounded-lg border border-line-strong bg-white text-sm"
        onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* unavailable */ } }}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

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

/** Production: people are added in Cognito with two attributes. */
function ManagedInCognito({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const pool = import.meta.env.VITE_COGNITO_USER_POOL_ID || '<user-pool-id>';
  const command = [
    `aws cognito-idp admin-create-user \\`,
    `  --user-pool-id ${pool} \\`,
    `  --username jane@company.com \\`,
    `  --user-attributes Name=email,Value=jane@company.com Name=email_verified,Value=true \\`,
    `    Name=custom:tenantId,Value=${tenantId} Name=custom:role,Value=tenant_auditor`,
  ].join('\n');
  return (
    <div className="flex flex-col gap-6 max-w-[900px]">
      <div>
        <p className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-0.02em]">People sign in through Amazon Cognito.</p>
        <p className="m-0 mt-1.5 text-ink-muted text-[15px]">Add them there with two attributes: which company ({tenantName || tenantId}) and which role. They get an email with a temporary password.</p>
      </div>
      <Panel className="px-6 py-5 flex flex-col gap-3">
        <SectionLabel>Add someone</SectionLabel>
        <CopyBlock text={command} />
        <p className="m-0 text-sm text-ink-muted">Change the email and role. To remove someone, disable or delete them in Cognito; their sign-in stops working at once.</p>
      </Panel>
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
    ? <ManagedInCognito tenantId={tenantId} tenantName={tenantName} />
    : <DemoAccounts tenantId={tenantId} tenantName={tenantName} me={user?.email} />;
}
