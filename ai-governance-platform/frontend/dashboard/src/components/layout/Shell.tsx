import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ScrollText, ShieldCheck, Cpu, Settings,
  Shield, Menu, Bell, BadgeCheck, ScanLine,
  Building2, Eye, LogOut, Sun, Moon, MessageSquare, Users, DollarSign,
  ChevronLeft, Search,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';

const platformAdminNav = [
  { label: 'Overview',        href: '/overview',        icon: LayoutDashboard },
  { label: 'AI Chat',         href: '/chat',            icon: MessageSquare },
  { label: 'Audit Logs',      href: '/audit-logs',      icon: ScrollText },
  { label: 'Policies',        href: '/policies',        icon: ShieldCheck },
  { label: 'Compliance',      href: '/compliance',      icon: BadgeCheck },
  { label: 'Content Scanner', href: '/content-scanner', icon: ScanLine },
  { label: 'Shadow AI',       href: '/shadow-ai',       icon: Eye },
  { label: 'Models',          href: '/models',          icon: Cpu },
  { label: 'Cost & Billing',  href: '/cost',            icon: DollarSign },
  { label: 'Tenants',         href: '/tenants',         icon: Building2 },
  { label: 'Settings',        href: '/settings',        icon: Settings },
];

const tenantAdminNav = [
  { label: 'Overview',        href: '/overview',        icon: LayoutDashboard },
  { label: 'AI Chat',         href: '/chat',            icon: MessageSquare },
  { label: 'Audit Logs',      href: '/audit-logs',      icon: ScrollText },
  { label: 'Policies',        href: '/policies',        icon: ShieldCheck },
  { label: 'Compliance',      href: '/compliance',      icon: BadgeCheck },
  { label: 'Content Scanner', href: '/content-scanner', icon: ScanLine },
  { label: 'Shadow AI',       href: '/shadow-ai',       icon: Eye },
  { label: 'Models',          href: '/models',          icon: Cpu },
  { label: 'Cost & Billing',  href: '/cost',            icon: DollarSign },
  { label: 'Users',           href: '/users',           icon: Users },
  { label: 'Settings',        href: '/settings',        icon: Settings },
];

const auditorNav = [
  { label: 'Overview',        href: '/overview',        icon: LayoutDashboard },
  { label: 'AI Chat',         href: '/chat',            icon: MessageSquare },
  { label: 'Audit Logs',      href: '/audit-logs',      icon: ScrollText },
];

const userNav = [
  { label: 'AI Chat',         href: '/chat',            icon: MessageSquare },
];

function getNavForRole(role: string) {
  switch (role) {
    case 'platform_admin': return platformAdminNav;
    case 'tenant_admin':   return tenantAdminNav;
    case 'tenant_auditor': return auditorNav;
    default:               return userNav;
  }
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout, isPlatformAdmin } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const nav = getNavForRole(user?.role || 'tenant_user');

  const handleLogout = () => { logout(); navigate('/login'); };
  const currentPage = nav.find((n) => n.href === location.pathname);

  const sidebarW = collapsed ? 'w-[68px]' : 'w-64';
  const mainPl = collapsed ? 'lg:pl-[68px]' : 'lg:pl-64';

  return (
    <div className={clsx('h-full flex', isDark ? 'bg-[#060810] text-slate-100' : 'bg-[#f0f2f7] text-gray-900')}>
      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 border-r',
          sidebarW,
          isDark ? 'bg-[#080b14] border-white/[0.06]' : 'bg-white border-gray-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className={clsx('h-16 flex items-center gap-2.5 border-b', collapsed ? 'px-4 justify-center' : 'px-5', isDark ? 'border-white/[0.06]' : 'border-gray-200/60')}>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-glow-brand flex-shrink-0">
            <Shield className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <>
              <span className={clsx('font-bold text-[15px] tracking-tight', isDark ? 'text-white' : 'text-gray-900')}>Aegis AI</span>
              {isPlatformAdmin && (
                <span className="ml-auto text-[10px] font-semibold text-brand-400 bg-brand-500/10 px-2 py-0.5 rounded-full border border-brand-500/20">
                  Admin
                </span>
              )}
            </>
          )}
        </div>

        {/* Tenant badge */}
        {!collapsed && (
          <div className={clsx('px-4 py-3 border-b', isDark ? 'border-white/[0.06]' : 'border-gray-200/60')}>
            <div className={clsx('flex items-center gap-2.5 px-3 py-2 rounded-xl', isDark ? 'bg-white/[0.04]' : 'bg-gray-50')}>
              <div className={clsx('w-2 h-2 rounded-full animate-pulse-soft', isPlatformAdmin ? 'bg-brand-400' : 'bg-accent-400')} />
              <span className={clsx('text-sm font-medium truncate', isDark ? 'text-slate-300' : 'text-gray-600')}>
                {user?.tenantName}
              </span>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className={clsx('flex-1 py-3 space-y-0.5 overflow-y-auto scrollbar-thin', collapsed ? 'px-2' : 'px-3')}>
          {nav.map(({ label, href, icon: Icon }) => (
            <NavLink
              key={href}
              to={href}
              onClick={() => setSidebarOpen(false)}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-xl text-[13px] font-medium transition-all duration-200',
                  collapsed ? 'px-3 py-2.5 justify-center' : 'px-3 py-2.5',
                  isActive
                    ? clsx('text-brand-400', isDark ? 'bg-brand-500/10 shadow-glow-brand' : 'bg-brand-50 shadow-sm')
                    : isDark
                      ? 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/80'
                )
              }
            >
              <Icon className="w-[18px] h-[18px] flex-shrink-0" />
              {!collapsed && label}
            </NavLink>
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className={clsx('px-3 py-2 border-t hidden lg:block', isDark ? 'border-white/[0.06]' : 'border-gray-200/60')}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={clsx('w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs transition-colors', isDark ? 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100')}
          >
            <ChevronLeft className={clsx('w-3.5 h-3.5 transition-transform', collapsed && 'rotate-180')} />
            {!collapsed && 'Collapse'}
          </button>
        </div>

        {/* User footer */}
        <div className={clsx('px-3 py-3 border-t', isDark ? 'border-white/[0.06]' : 'border-gray-200/60')}>
          <div className={clsx('flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
            <div className={clsx(
              'rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-600/20 flex items-center justify-center text-brand-400 text-xs font-bold flex-shrink-0',
              collapsed ? 'w-9 h-9' : 'w-9 h-9'
            )}>
              {user?.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className={clsx('text-sm font-medium truncate', isDark ? 'text-white' : 'text-gray-900')}>{user?.name}</p>
                  <p className={clsx('text-[11px] truncate', isDark ? 'text-slate-500' : 'text-gray-400')}>{user?.email}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className={clsx('p-1.5 rounded-lg transition-colors', isDark ? 'text-slate-500 hover:text-red-400 hover:bg-red-500/10' : 'text-gray-400 hover:text-red-500 hover:bg-red-50')}
                  title="Sign out"
                  aria-label="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className={clsx('flex-1 flex flex-col min-h-0 transition-all duration-300', mainPl)}>
        {/* Topbar */}
        <header className={clsx(
          'h-16 flex items-center gap-4 px-6 border-b backdrop-blur-md sticky top-0 z-30',
          isDark ? 'bg-[#060810]/80 border-white/[0.06]' : 'bg-[#f0f2f7]/90 border-gray-200'
        )}>
          <button
            className={clsx('lg:hidden', isDark ? 'text-slate-400' : 'text-gray-500')}
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div>
            <h1 className={clsx('text-base font-semibold', isDark ? 'text-white' : 'text-gray-900')}>
              {currentPage?.label ?? 'Dashboard'}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={toggleTheme}
              className={clsx(
                'p-2 rounded-xl transition-all duration-200',
                isDark ? 'text-slate-400 hover:text-yellow-400 hover:bg-white/[0.06]' : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100'
              )}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
            >
              {isDark ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
            </button>
            <button
              className={clsx('relative p-2 rounded-xl transition-all duration-200', isDark ? 'text-slate-400 hover:bg-white/[0.06]' : 'text-gray-400 hover:bg-gray-100')}
              aria-label="Notifications"
            >
              <Bell className="w-[18px] h-[18px]" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-500 ring-2 ring-[#060810]" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
