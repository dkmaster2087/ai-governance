import { useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { DocsPage } from './pages/DocsPage';

/** The documentation site: technical setup and reference, kept apart from the sales website. */
export default function App() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2 focus:rounded">Skip to content</a>
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-line">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-10 min-h-[60px] flex items-center gap-3">
          <Link to="/docs" aria-label="Probaline docs home" className="flex items-center gap-2.5 min-h-[44px] font-bold text-[18px] tracking-[-0.015em] text-ink no-underline">
            <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true"><path d="M10.5 4.5h11M16 4.5v13.4" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" /><path d="M16 17.6L20.2 22.6L16 29L11.8 22.6Z" className="fill-brass stroke-brass" strokeWidth="1" strokeLinejoin="round" /></svg>
            Probaline
          </Link>
          <span className="text-ink-muted">Docs</span>
        </div>
      </header>
      <main id="main" className="flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/docs" replace />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:slug" element={<DocsPage />} />
          <Route path="*" element={<Navigate to="/docs" replace />} />
        </Routes>
      </main>
    </div>
  );
}
