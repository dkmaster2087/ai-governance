import { useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth, UserRole } from '../../lib/auth';

interface NavItem {
  label: string;
  href: string;
}

interface RoleNav {
  primary: NavItem[];
  more: NavItem[];
}

// Direction I navigation. Rules and Evidence use the existing Policies and Audit Logs pages
// until their redesigned versions land.
const NAV: Record<Exclude<UserRole, 'tenant_user'>, RoleNav> = {
  tenant_admin: {
    primary: [
      { label: 'Gateway', href: '/gateway' },
      { label: 'Stopped', href: '/stopped' },
      { label: 'Shadow AI', href: '/shadow-ai' },
      { label: 'Rules', href: '/policies' },
      { label: 'Evidence', href: '/audit-logs' },
    ],
    more: [
      { label: 'Models & keys', href: '/models' },
      { label: 'Spend', href: '/cost' },
      { label: 'Compliance', href: '/compliance' },
      { label: 'Users', href: '/users' },
      { label: 'License', href: '/license' },
      { label: 'Settings', href: '/settings' },
    ],
  },
  tenant_auditor: {
    primary: [
      { label: 'Gateway', href: '/gateway' },
      { label: 'Stopped', href: '/stopped' },
      { label: 'Evidence', href: '/audit-logs' },
    ],
    more: [],
  },
  platform_admin: {
    primary: [
      { label: 'Platform', href: '/overview' },
      { label: 'Tenants', href: '/tenants' },
      { label: 'Licenses', href: '/licenses' },
      { label: 'Usage', href: '/analytics' },
      { label: 'Spend', href: '/cost' },
      { label: 'Shadow AI', href: '/shadow-ai' },
      { label: 'Health', href: '/health' },
    ],
    more: [{ label: 'Settings', href: '/settings' }],
  },
};

/** Pages already rebuilt in the new style render their own headline; older ones get a plain title. */
const REDESIGNED = new Set(['/gateway', '/stopped', '/shadow-ai']);

function Logo() {
  return (
    <span className="flex items-center gap-2.5 font-extrabold text-[17px] tracking-[0.06em] uppercase">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
      </svg>
      Aegis
    </span>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'flex items-center min-h-[44px] no-underline',
    isActive ? 'font-semibold text-ink shadow-[inset_0_-2px_0_#14213D]' : 'text-ink-muted hover:text-ink'
  );

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const moreRef = useRef<HTMLDetailsElement>(null);
  const accountRef = useRef<HTMLDetailsElement>(null);

  const nav = user && user.role !== 'tenant_user' ? NAV[user.role] : { primary: [], more: [] };
  const all = [...nav.primary, ...nav.more];
  const current = all.find((n) => location.pathname === n.href || location.pathname.startsWith(n.href + '/'));
  const moreActive = !!current && nav.more.includes(current);
  const closeMenus = () => {
    moreRef.current?.removeAttribute('open');
    accountRef.current?.removeAttribute('open');
  };
  const handleLogout = () => { closeMenus(); logout(); navigate('/login'); };

  return (
    <div className="min-h-full bg-canvas text-ink font-sans text-sm leading-[1.45]">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-2 px-5 sm:px-10 min-h-[64px] bg-white border-b border-line">
        <Logo />
        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-6 gap-y-1">
          {nav.primary.map((n) => (
            <NavLink key={n.href} to={n.href} className={linkClass}>{n.label}</NavLink>
          ))}
          {nav.more.length > 0 && (
            <details ref={moreRef} className="relative">
              <summary className={clsx('flex items-center min-h-[44px] cursor-pointer list-none', moreActive ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink')}>
                {moreActive ? current?.label : 'More'}
                <svg className="ml-1" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </summary>
              <div className="absolute left-0 top-full z-20 mt-1 min-w-[200px] bg-white border border-line rounded-xl py-1.5 shadow-[0_8px_24px_rgba(20,33,61,0.08)]">
                {nav.more.map((n) => (
                  <NavLink
                    key={n.href}
                    to={n.href}
                    onClick={closeMenus}
                    className={({ isActive }) => clsx('flex items-center min-h-[40px] px-4 no-underline', isActive ? 'font-semibold text-ink bg-ink-tint' : 'text-ink hover:bg-canvas')}
                  >
                    {n.label}
                  </NavLink>
                ))}
              </div>
            </details>
          )}
        </nav>

        <details ref={accountRef} className="relative ml-auto">
          <summary className="flex items-center gap-2 min-h-[44px] cursor-pointer list-none text-ink-muted hover:text-ink">
            <span>{user?.tenantName}</span>
            <span aria-hidden="true" className="w-8 h-8 rounded-full bg-ink-tint text-ink font-semibold flex items-center justify-center text-xs">
              {(user?.name ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('')}
            </span>
            <span className="sr-only">Account menu</span>
          </summary>
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[220px] bg-white border border-line rounded-xl py-2 shadow-[0_8px_24px_rgba(20,33,61,0.08)]">
            <div className="px-4 pb-2 border-b border-line-subtle">
              <div className="font-semibold text-ink">{user?.name}</div>
              <div className="text-xs text-ink-muted">{user?.email}</div>
            </div>
            <button type="button" onClick={handleLogout} className="w-full text-left min-h-[40px] px-4 text-ink hover:bg-canvas">
              Sign out
            </button>
          </div>
        </details>
      </header>

      <main className="px-5 sm:px-10 pt-8 pb-14">
        {!REDESIGNED.has(location.pathname) && current && (
          <h1 className="m-0 mb-6 text-[28px] font-bold tracking-[-0.02em]">{current.label}</h1>
        )}
        {children}
      </main>
    </div>
  );
}
