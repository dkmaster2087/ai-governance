import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchLicenseStatus, statusMessage } from '../../lib/license-api';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { PlumbMark } from '../kit/PlumbMark';
import { useAuth, UserRole } from '../../lib/auth';

interface NavItem {
  label: string;
  href: string;
}

interface RoleNav {
  primary: NavItem[];
  more: NavItem[];
}

// Direction I navigation.
const NAV: Record<Exclude<UserRole, 'tenant_user'>, RoleNav> = {
  tenant_admin: {
    primary: [
      { label: 'Gateway', href: '/gateway' },
      { label: 'Stopped', href: '/stopped' },
      { label: 'Shadow AI', href: '/shadow-ai' },
      { label: 'Rules', href: '/rules' },
      { label: 'MCP servers', href: '/mcp' },
      { label: 'Evidence', href: '/evidence' },
    ],
    more: [
      { label: 'API keys', href: '/keys' },
      { label: 'Models & keys', href: '/models' },
      { label: 'Spend', href: '/cost' },
      { label: 'Compliance', href: '/compliance' },
      { label: 'Users', href: '/users' },
      { label: 'Activity', href: '/activity' },
      { label: 'Log export', href: '/log-export' },
      { label: 'License', href: '/license' },
      { label: 'Settings', href: '/settings' },
    ],
  },
  tenant_auditor: {
    primary: [
      { label: 'Gateway', href: '/gateway' },
      { label: 'Stopped', href: '/stopped' },
      { label: 'Evidence', href: '/evidence' },
      { label: 'Approvals', href: '/mcp/approvals' },
    ],
    more: [{ label: 'Activity', href: '/activity' }],
  },
  platform_admin: {
    primary: [
      { label: 'Platform', href: '/overview' },
      { label: 'Tenants', href: '/tenants' },
      { label: 'Licenses', href: '/licenses' },
      { label: 'Usage', href: '/analytics' },
      { label: 'Health', href: '/health' },
    ],
    more: [{ label: 'Settings', href: '/settings' }],
  },
};

/** These pages render their own headline instead of the plain page title. */
const REDESIGNED = new Set(['/gateway', '/stopped', '/shadow-ai', '/rules', '/evidence', '/keys', '/mcp', '/activity', '/log-export']);

/** The logo is also the way home. */
function Logo({ to }: { to: string }) {
  return (
    <Link to={to} aria-label="Probaline home" className="flex items-center gap-2.5 min-h-[44px] font-bold text-[19px] tracking-[-0.015em] text-ink no-underline">
      <PlumbMark />
      Probaline
    </Link>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'flex items-center min-h-[44px] no-underline',
    isActive ? 'font-semibold text-ink shadow-[inset_0_-2px_0_#14213D]' : 'text-ink-muted hover:text-ink'
  );

/** The company's license, on every page, whenever something needs doing about it. */
function LicenseBanner({ canEnterKey }: { canEnterKey: boolean }) {
  const { data } = useQuery({ queryKey: ['license-status'], queryFn: fetchLicenseStatus, staleTime: 60_000, refetchInterval: 5 * 60_000, retry: false });
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem('probaline:license-banner') === 'hidden'; } catch { return false; } });
  const message = data ? statusMessage(data, canEnterKey) : null;
  // Only the "expires soon" notice can be put away (for this session); the others stay until fixed.
  if (!message || (data?.state === 'expiring' && hidden)) return null;
  return (
    <div role={message.tone === 'stop' ? 'alert' : 'status'} aria-label="License"
      className={clsx('px-5 sm:px-10 py-3 border-b flex flex-wrap items-center gap-x-4 gap-y-2', message.tone === 'stop' ? 'bg-stop-soft border-stop text-stop-text' : 'bg-[#FFF7E0] border-[#E9D18A] text-ink')}>
      <div className="flex-1 min-w-[240px]">
        <p className="m-0 font-semibold">{message.title}</p>
        <p className="m-0 text-sm">{message.detail}</p>
      </div>
      {canEnterKey && <Link to="/license" className="font-semibold underline whitespace-nowrap">Enter a license key</Link>}
      {data?.state === 'expiring' && (
        <button type="button" className="text-sm underline" onClick={() => { setHidden(true); try { sessionStorage.setItem('probaline:license-banner', 'hidden'); } catch { /* unavailable */ } }}>Hide for now</button>
      )}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const moreRef = useRef<HTMLDetailsElement>(null);
  const accountRef = useRef<HTMLDetailsElement>(null);

  // Plain users only reach the dashboard to approve agents' requests.
  const nav = user && user.role !== 'tenant_user' ? NAV[user.role] : { primary: [{ label: 'Approvals', href: '/mcp/approvals' }], more: [] };
  const all = [...nav.primary, ...nav.more];
  const current = all.find((n) => location.pathname === n.href || location.pathname.startsWith(n.href + '/'));
  const moreActive = !!current && nav.more.includes(current);
  const closeMenus = () => {
    moreRef.current?.removeAttribute('open');
    accountRef.current?.removeAttribute('open');
  };
  const handleLogout = () => { closeMenus(); logout(); navigate('/login'); };

  // Menus close on a click or tap anywhere else, on Escape, and when the page changes.
  useEffect(() => {
    const menus = () => [moreRef.current, accountRef.current].filter((m): m is HTMLDetailsElement => !!m);
    const onPointer = (e: PointerEvent) => {
      for (const m of menus()) if (m.open && !m.contains(e.target as Node)) m.removeAttribute('open');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      for (const m of menus()) {
        if (!m.open) continue;
        m.removeAttribute('open');
        m.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, []);
  useEffect(() => { closeMenus(); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-full bg-canvas text-ink font-sans text-sm leading-[1.45]">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-8 gap-y-2 px-5 sm:px-10 min-h-[64px] bg-white border-b border-line">
        <Logo to={user?.role === 'platform_admin' ? '/overview' : user?.role === 'tenant_user' ? '/mcp/approvals' : '/gateway'} />
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

      {user && user.role !== 'platform_admin' && <LicenseBanner canEnterKey={user.role === 'tenant_admin'} />}
      <main className="px-5 sm:px-10 pt-8 pb-14">
        {!REDESIGNED.has(location.pathname) && !location.pathname.startsWith("/tenants/") && !location.pathname.startsWith("/mcp/") && current && (
          <h1 className="m-0 mb-6 text-[28px] font-bold tracking-[-0.02em]">{current.label}</h1>
        )}
        {children}
      </main>
    </div>
  );
}
