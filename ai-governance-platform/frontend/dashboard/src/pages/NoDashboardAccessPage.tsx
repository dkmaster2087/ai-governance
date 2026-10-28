import clsx from 'clsx';
import { Shield, LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';

/** Shown to users whose role has no dashboard access (tenant_user). They use AI through approved apps. */
export function NoDashboardAccessPage() {
  const { user, logout } = useAuth();
  const { isDark } = useTheme();
  return (
    <div className={clsx('min-h-screen flex items-center justify-center p-4', isDark ? 'bg-[#060810]' : 'bg-[#f0f2f7]')}>
      <div className={clsx('max-w-md w-full border rounded-2xl p-8 text-center', isDark ? 'bg-[#111827]/80 border-white/[0.06]' : 'bg-white border-gray-200')}>
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mx-auto mb-5">
          <Shield className="w-6 h-6 text-white" />
        </div>
        <h1 className={clsx('text-lg font-semibold mb-2', isDark ? 'text-white' : 'text-gray-900')}>No dashboard access</h1>
        <p className={clsx('text-sm mb-6', isDark ? 'text-slate-400' : 'text-gray-500')}>
          Your account{user?.tenantName ? ` at ${user.tenantName}` : ''} can use AI through your organization’s approved
          tools, but doesn’t include access to the governance dashboard. Ask an administrator if you need it.
        </p>
        <button
          onClick={logout}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium"
        >
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    </div>
  );
}
