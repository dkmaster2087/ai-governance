import { Link } from 'react-router-dom';
import { Logo } from './Navbar';

const COLUMNS = [
  { title: 'Product', links: [['Overview', '/product'], ['Pricing', '/pricing'], ['Deployment', '/deployment'], ['Security', '/security']] },
  { title: 'Docs', links: [['Quick start', '/docs/quick-start'], ['Connect IDEs', '/docs/proxy-mode'], ['Browser extension', '/docs/browser-extension'], ['API reference', '/docs/api']] },
  { title: 'Company', links: [['About', '/about'], ['Contact', '/contact']] },
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-canvas">
      <div className="max-w-[1200px] mx-auto px-5 sm:px-10 py-12 flex flex-wrap gap-x-16 gap-y-10">
        <div className="flex-[1_1_240px]">
          <Logo />
          <p className="m-0 mt-2 text-ink-muted max-w-[280px]">The gateway every AI request in your company passes through.</p>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title} className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted mb-1">{c.title}</span>
            {c.links.map(([label, to]) => <Link key={to} to={to} className="min-h-[32px] flex items-center text-ink no-underline hover:text-stop">{label}</Link>)}
          </nav>
        ))}
      </div>
      <div className="max-w-[1200px] mx-auto px-5 sm:px-10 pb-8 text-xs text-ink-muted">© {new Date().getFullYear()} Aegis</div>
    </footer>
  );
}
