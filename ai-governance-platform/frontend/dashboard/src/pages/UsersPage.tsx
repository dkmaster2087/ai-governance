import { useState } from 'react';
import { Plus, Trash2, UserPlus, Shield, Eye, MessageSquare } from 'lucide-react';
import clsx from 'clsx';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';
import { useAuth, getTenantUsers, registerTenantAccount, deleteUserAccount, UserRole, AuthUser } from '../lib/auth';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

const ROLE_CONFIG: Record<string, { label: string; icon: typeof Shield; color: string; description: string }> = {
  tenant_admin:   { label: 'Admin',   icon: Shield,         color: 'text-brand-400 bg-brand-600/20', description: 'Full access to tenant dashboard' },
  tenant_auditor: { label: 'Auditor', icon: Eye,            color: 'text-yellow-400 bg-yellow-500/20', description: 'View audit logs and compliance' },
  tenant_user:    { label: 'User',    icon: MessageSquare,  color: 'text-accent-400 bg-accent-500/20', description: 'AI chat access only' },
};

export function UsersPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const { user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AuthUser | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Form state
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('tenant_user');

  const tenantId = user?.tenantId || '';
  const tenantName = user?.tenantName || '';
  const users = getTenantUsers(tenantId);

  const handleAdd = () => {
    if (!newName.trim() || !newEmail.trim()) return;
    registerTenantAccount({
      email: newEmail,
      password: newPassword || 'welcome123',
      name: newName,
      role: newRole,
      tenantId,
      tenantName,
    });
    setNewName(''); setNewEmail(''); setNewPassword(''); setNewRole('tenant_user');
    setShowAdd(false);
    setRefreshKey((k) => k + 1);
  };

  const handleDelete = () => {
    if (confirmDelete) {
      deleteUserAccount(confirmDelete.email);
      setConfirmDelete(null);
      setRefreshKey((k) => k + 1);
    }
  };

  return (
    <div className="space-y-5" key={refreshKey}>
      <div className="flex items-center justify-between">
        <div>
          <p className={clsx('text-sm', t.sub)}>{users.length} users in {tenantName}</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {/* Add user form */}
      {showAdd && (
        <div className={clsx('border rounded-xl p-5 space-y-4', t.card)}>
          <h3 className={clsx('text-sm font-semibold', t.heading)}>Add New User</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={clsx('block text-xs mb-1.5', t.sub)}>Full name</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Jane Smith" className={clsx('w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-500', t.input)} />
            </div>
            <div>
              <label className={clsx('block text-xs mb-1.5', t.sub)}>Email</label>
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="jane@company.com" className={clsx('w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-500', t.input)} />
            </div>
            <div>
              <label className={clsx('block text-xs mb-1.5', t.sub)}>Password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Default: welcome123" className={clsx('w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-500', t.input)} />
            </div>
            <div>
              <label className={clsx('block text-xs mb-1.5', t.sub)}>Role</label>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)} className={clsx('w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-500', t.input)}>
                <option value="tenant_user">User — Chat only</option>
                <option value="tenant_auditor">Auditor — View audit logs</option>
                <option value="tenant_admin">Admin — Full access</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowAdd(false)} className={clsx('px-4 py-2 rounded-lg text-sm transition-colors', t.btnSecondary)}>Cancel</button>
            <button onClick={handleAdd} disabled={!newName.trim() || !newEmail.trim()} className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              Add User
            </button>
          </div>
        </div>
      )}

      {/* User list */}
      <div className="space-y-2">
        {users.map((u) => {
          const rc = ROLE_CONFIG[u.role] || ROLE_CONFIG.tenant_user;
          const Icon = rc.icon;
          const isCurrentUser = u.email === user?.email;
          return (
            <div key={u.email} className={clsx('flex items-center gap-4 border rounded-xl px-5 py-4', t.card)}>
              <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', rc.color)}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={clsx('font-medium', t.heading)}>{u.name}</p>
                  {isCurrentUser && <span className={clsx('text-xs px-2 py-0.5 rounded-full', 'bg-brand-600/20 text-brand-400')}>You</span>}
                </div>
                <p className={clsx('text-xs', t.muted)}>{u.email}</p>
              </div>
              <span className={clsx('text-xs px-2.5 py-1 rounded-full font-medium', rc.color)}>{rc.label}</span>
              <p className={clsx('text-xs max-w-[150px]', t.faint)}>{rc.description}</p>
              {!isCurrentUser && u.role !== 'platform_admin' && (
                <button onClick={() => setConfirmDelete(u)} className={clsx('p-2 rounded-lg transition-colors', t.faint, 'hover:text-red-400 hover:bg-red-500/10')}>
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Remove user?"
        message={`Remove ${confirmDelete?.name} (${confirmDelete?.email}) from ${tenantName}? They will no longer be able to log in.`}
        confirmLabel="Remove"
        confirmVariant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
