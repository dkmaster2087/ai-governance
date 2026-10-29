import { useEffect, useRef } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { DASHBOARD_URL } from '../../lib/config';

const LINKS = [
  { label: 'Product', to: '/product' },
  { label: 'Docs', to: '/docs' },
  { label: 'Deployment', to: '/deployment' },
  { label: 'Security', to: '/security' },
  { label: 'Pricing', to: '/pricing' },
];

export function Logo() {
  return (
    <Link to="/" aria-label="Aegis home" className="flex items-center gap-2.5 min-h-[44px] font-extrabold text-[17px] tracking-[0.06em] uppercase text-ink no-underline">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
      </svg>
      Aegis
    </Link>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  clsx('flex items-center min-h-[44px] no-underline', isActive ? 'font-semibold text-ink shadow-[inset_0_-2px_0_#14213D]' : 'text-ink-muted hover:text-ink');

/** Stays at the top while the page scrolls. */
export function Navbar() {
  const menu = useRef<HTMLDetailsElement>(null);
  const location = useLocation();
  useEffect(() => { menu.current?.removeAttribute('open'); }, [location.pathname]);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-line">
      <div className="max-w-[1200px] mx-auto px-5 sm:px-10 min-h-[64px] flex items-center gap-8">
        <Logo />
        <nav aria-label="Main" className="hidden md:flex items-center gap-7 text-[15px]">
          {LINKS.map((l) => <NavLink key={l.to} to={l.to} className={linkClass}>{l.label}</NavLink>)}
        </nav>
        <div className="ml-auto hidden md:flex items-center gap-3">
          <a href={DASHBOARD_URL} className="min-h-[44px] flex items-center px-2 text-ink-muted hover:text-ink no-underline">Sign in</a>
          <Link to="/contact" className="min-h-[40px] flex items-center px-4 rounded-lg bg-ink text-white font-semibold no-underline hover:bg-[#1E2F54]">Book a demo</Link>
        </div>
        <details ref={menu} className="md:hidden ml-auto relative">
          <summary className="list-none cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </summary>
          <nav aria-label="Main" className="absolute right-0 top-full mt-1 w-56 bg-white border border-line rounded-xl py-2 shadow-[0_8px_24px_rgba(20,33,61,0.08)]">
            {LINKS.map((l) => <NavLink key={l.to} to={l.to} className="flex items-center min-h-[44px] px-4 no-underline text-ink">{l.label}</NavLink>)}
            <a href={DASHBOARD_URL} className="flex items-center min-h-[44px] px-4 no-underline text-ink">Sign in</a>
            <Link to="/contact" className="flex items-center min-h-[44px] px-4 no-underline font-semibold text-ink">Book a demo</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
