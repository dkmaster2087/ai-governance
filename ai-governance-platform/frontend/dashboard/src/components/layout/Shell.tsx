import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchLicenseStatus, statusMessage } from '../../lib/license-api';
import { listApprovals } from '../../lib/mcp-api';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { PlumbMark } from '../kit/PlumbMark';
import { useAuth, UserRole } from '../../lib/auth';

interface NavItem {
  label: string;
  href: string;
}

/** A menu section: one link in the bar, and a row of tabs for its pages when it has more than one. */
interface Section {
  label: string;
  tabs: NavItem[];
}

interface RoleNav {
  sections: Section[];
  /** Set-up pages, behind the gear icon. */
  admin: NavItem[];
}

/**
 * Five sections for a company admin (what's happening, where AI is used, what's allowed, the proof, set-up),
 * instead of seventeen menu items. Every page keeps its address, so links in emails, docs and bookmarks still work.
 */
export const NAV: Record<UserRole, RoleNav> = {
  tenant_admin: {
    sections: [
      { label: 'Overview', tabs: [{ label: 'Traffic', href: '/gateway' }, { label: 'Spend', href: '/cost' }] },
      { label: 'AI use', tabs: [{ label: 'Tools', href: '/shadow-ai' }, { label: 'Paths & locks', href: '/enforcement' }] },
      {
        label: 'Controls',
        tabs: [{ label: 'Rules', href: '/rules' }, { label: 'Models', href: '/models' }, { label: 'MCP servers', href: '/mcp' }, { label: 'Alerts', href: '/alerts' }],
      },
      {
        label: 'Audit',
        tabs: [
          { label: 'Case files', href: '/evidence' }, { label: 'Stopped', href: '/stopped' }, { label: 'Compliance', href: '/compliance' },
          { label: 'Activity', href: '/activity' }, { label: 'Log export', href: '/log-export' },
        ],
      },
    ],
    admin: [{ label: 'Users', href: '/users' }, { label: 'API keys', href: '/keys' }, { label: 'License', href: '/license' }, { label: 'Settings', href: '/settings' }],
  },
  tenant_auditor: {
    sections: [
      { label: 'Overview', tabs: [{ label: 'Traffic', href: '/gateway' }] },
      { label: 'Audit', tabs: [{ label: 'Case files', href: '/evidence' }, { label: 'Stopped', href: '/stopped' }, { label: 'Activity', href: '/activity' }] },
    ],
    admin: [],
  },
  platform_admin: {
    sections: [
      { label: 'Platform', tabs: [{ label: 'Platform', href: '/overview' }] },
      { label: 'Customers', tabs: [{ label: 'Tenants', href: '/tenants' }, { label: 'Licenses', href: '/licenses' }] },
      { label: 'Usage', tabs: [{ label: 'Usage', href: '/analytics' }] },
      { label: 'AI catalog', tabs: [{ label: 'Review', href: '/catalog' }] },
      { label: 'Health', tabs: [{ label: 'Health', href: '/health' }] },
    ],
    admin: [{ label: 'Settings', href: '/settings' }],
  },
  // Plain users only reach the dashboard to approve agents' requests.
  tenant_user: { sections: [{ label: 'Approvals', tabs: [{ label: 'Approvals', href: '/mcp/approvals' }] }], admin: [] },
};

/** The page a path belongs to: the longest matching address wins (`/mcp/approvals` is under `/mcp`). */
export function findPage(nav: RoleNav, path: string): { section: Section | null; tab: NavItem } | null {
  const candidates = [
    ...nav.sections.flatMap((section) => section.tabs.map((tab) => ({ section: section as Section | null, tab }))),
    ...nav.admin.map((tab) => ({ section: null, tab })),
  ];
  const hits = candidates.filter(({ tab }) => path === tab.href || path.startsWith(tab.href + '/'));
  return hits.sort((a, b) => b.tab.href.length - a.tab.href.length)[0] ?? null;
}

/** These pages render their own headline instead of the plain page title. */
const REDESIGNED = new Set(['/gateway', '/stopped', '/shadow-ai', '/rules', '/evidence', '/keys', '/mcp', '/activity', '/log-export', '/enforcement']);

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

/** Agents' requests waiting for a person, on every page, so they're answered quickly. Nothing shows when none wait. */
function ApprovalsWaiting() {
  const { data } = useQuery({ queryKey: ['mcp-approvals'], queryFn: listApprovals, staleTime: 15_000, refetchInterval: 30_000, retry: false });
  const waiting = (data ?? []).filter((a) => a.status === 'pending').length;
  if (!waiting) return null;
  return (
    <Link to="/mcp/approvals" className="flex items-center gap-2 min-h-[36px] px-3 rounded-lg bg-[#FFF7E0] border border-[#E9D18A] text-ink font-semibold no-underline whitespace-nowrap hover:bg-[#FCEFC7]">
      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-ink text-white text-xs flex items-center justify-center">{waiting}</span>
      {waiting === 1 ? 'approval waiting' : 'approvals waiting'}
    </Link>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const adminRef = useRef<HTMLDetailsElement>(null);
  const accountRef = useRef<HTMLDetailsElement>(null);

  const nav = NAV[user?.role ?? 'tenant_user'];
  const page = findPage(nav, location.pathname);
  const current = page?.tab;
  const adminActive = !!page && page.section === null;
  // Tabs under the bar: the current section's pages, or the set-up pages while on one of them.
  const tabs = adminActive ? nav.admin : page?.section && page.section.tabs.length > 1 ? page.section.tabs : [];
  const tabsLabel = adminActive ? 'Admin' : page?.section?.label;
  const closeMenus = () => {
    adminRef.current?.removeAttribute('open');
    accountRef.current?.removeAttribute('open');
  };
  const handleLogout = () => { closeMenus(); logout(); navigate('/login'); };

  // Menus close on a click or tap anywhere else, on Escape, and when the page changes.
  useEffect(() => {
    const menus = () => [adminRef.current, accountRef.current].filter((m): m is HTMLDetailsElement => !!m);
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
          {nav.sections.map((sec) => (
            <Link
              key={sec.label}
              to={sec.tabs[0].href}
              className={linkClass({ isActive: page?.section === sec })}
              aria-current={page?.section === sec ? 'page' : undefined}
            >
              {sec.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          {user && user.role !== 'platform_admin' && <ApprovalsWaiting />}
          {nav.admin.length > 0 && (
            <details ref={adminRef} className="relative">
              <summary
                aria-label="Admin"
                className={clsx('flex items-center justify-center min-h-[44px] min-w-[44px] cursor-pointer list-none rounded-lg', adminActive ? 'text-ink bg-ink-tint' : 'text-ink-muted hover:text-ink')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </summary>
              <div className="absolute right-0 top-full z-20 mt-1 min-w-[200px] bg-white border border-line rounded-xl py-1.5 shadow-[0_8px_24px_rgba(20,33,61,0.08)]">
                {nav.admin.map((n) => (
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
        <details ref={accountRef} className="relative">
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
        </div>
      </header>

      {tabs.length > 0 && (
        <nav aria-label={`${tabsLabel} pages`} className="px-5 sm:px-10 bg-white border-b border-line flex flex-wrap gap-x-6 overflow-x-auto">
          {tabs.map((t) => (
            <Link
              key={t.href}
              to={t.href}
              className={clsx('flex items-center min-h-[44px] no-underline whitespace-nowrap', current === t ? 'font-semibold text-ink shadow-[inset_0_-2px_0_#14213D]' : 'text-ink-muted hover:text-ink')}
              aria-current={current === t ? 'page' : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}
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
