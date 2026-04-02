import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ScrollText, ShieldCheck, Cpu, Settings,
  Shield, Menu, Bell, BadgeCheck, ScanLine,
  Building2, Eye, LogOut, Sun, Moon, MessageSquare, Users, DollarSign,
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
  const { user, logout, isPlatformAdmin } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const nav = getNavForRole(user?.role || 'tenant_user');

  const handleLogout = () => { logout(); navigate('/login'); };
  const currentPage = nav.find((n) => n.href === location.pathname);

  // Reusable theme classes
  const card = isDark ? 'bg-slate-900 border-white/10' : 'bg-white border-gray-200';
  const cardInner = isDark ? 'bg-slate-800' : 'bg-gray-100';
  const border = isDark ? 'border-white/10' : 'border-gray-200';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-slate-400' : 'text-gray-500';
  const textMuted = isDark ? 'text-slate-500' : 'text-gray-400';
  const topbar = isDark ? 'bg-slate-950/80' : 'bg-white/80';
  const mainBg = isDark ? 'bg-slate-950' : 'bg-gray-50';

  return (
    <div className={clsx('h-full flex', mainBg, isDark ? 'text-slate-100' : 'text-gray-900')}>
      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 w-60 flex flex-col transition-transform duration-200 border-r',
          card,
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className={clsx('h-16 flex items-center gap-2 px-5 border-b', border)}>
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <span className={clsx('font-bold', textPrimary)}>Aegis AI</span>
          {isPlatformAdmin && (
            <span className="ml-auto text-xs text-brand-400 bg-brand-600/20 px-2 py-0.5 rounded-full">
              Admin
            </span>
          )}
        </div>

        {/* Tenant badge */}
        <div className={clsx('px-4 py-3 border-b', border)}>
          <div className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg', cardInner)}>
            <div className={clsx('w-2 h-2 rounded-full', isPlatformAdmin ? 'bg-brand-400' : 'bg-accent-400')} />
            <span className={clsx('text-sm font-medium truncate', isDark ? 'text-slate-300' : 'text-gray-700')}>
              {user?.tenantName}
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-thin">
          {nav.map(({ label, href, icon: Icon }) => (
            <NavLink
              key={href}
              to={href}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-600/20 text-brand-400'
                    : isDark
                      ? 'text-slate-400 hover:text-white hover:bg-white/5'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                )
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className={clsx('px-4 py-4 border-t', border)}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-brand-600/30 flex items-center justify-center text-brand-400 text-xs font-bold flex-shrink-0">
              {user?.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className={clsx('text-sm font-medium truncate', textPrimary)}>{user?.name}</p>
              <p className={clsx('text-xs truncate', textMuted)}>{user?.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className={clsx('transition-colors flex-shrink-0', isDark ? 'text-slate-500 hover:text-red-400' : 'text-gray-400 hover:text-red-500')}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className={clsx('flex-1 flex flex-col lg:pl-60 min-h-0', mainBg)}>
        {/* Topbar */}
        <header className={clsx('h-16 flex items-center gap-4 px-6 border-b backdrop-blur sticky top-0 z-30', border, topbar)}>
          <button
            className={clsx('lg:hidden', textSecondary)}
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h1 className={clsx('text-base font-semibold', textPrimary)}>
            {currentPage?.label ?? 'Dashboard'}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className={clsx(
                'p-2 rounded-lg transition-colors',
                isDark ? 'text-slate-400 hover:text-yellow-400 hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              )}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              className={clsx('relative p-2 rounded-lg transition-colors', textSecondary)}
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-500" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto scrollbar-thin p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
