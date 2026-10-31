import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

const base =
  'inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-lg text-[15px] no-underline transition-colors ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

export function CtaLink({ to, children, variant = 'primary', className }: { to: string; children: ReactNode; variant?: 'primary' | 'secondary'; className?: string }) {
  const styles = variant === 'primary' ? 'bg-ink text-white font-semibold hover:bg-[#1E2F54]' : 'bg-white text-ink border border-line-strong hover:border-ink-faint';
  const external = /^https?:/.test(to);
  return external
    ? <a href={to} className={clsx(base, styles, className)}>{children}</a>
    : <Link to={to} className={clsx(base, styles, className)}>{children}</Link>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={clsx('m-0 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted', className)}>{children}</p>;
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('max-w-[1200px] mx-auto px-5 sm:px-10', className)}>{children}</div>;
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('bg-white border border-line rounded-[14px]', className)}>{children}</div>;
}

/** Page header used by inner pages: a plain headline and a sentence. */
export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="pt-16 pb-10 sm:pt-20">
      {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
      <h1 className="m-0 text-[40px] sm:text-[52px] leading-[1.06] font-bold tracking-[-0.03em] max-w-[900px]">{title}</h1>
      {children && <p className="m-0 mt-5 text-lg text-ink-muted max-w-[720px] leading-relaxed">{children}</p>}
    </header>
  );
}

/** Whether something can be bought today. The site never presents a planned piece as available. */
export function Status({ value, className }: { value: 'Available' | 'Beta' | 'Coming'; className?: string }) {
  return (
    <span className={clsx(
      'inline-flex items-center self-start text-[11px] font-semibold uppercase tracking-[0.05em] px-2 py-0.5 rounded-full whitespace-nowrap',
      value === 'Available' && 'bg-ink text-white',
      value === 'Beta' && 'bg-ink-tint text-ink',
      value === 'Coming' && 'border border-dashed border-line-strong text-ink-muted',
      className,
    )}>{value}</span>
  );
}

/** A section with an eyebrow and a headline. */
export function Section({ id, eyebrow, title, intro, children, tone = 'white' }: { id?: string; eyebrow?: string; title: ReactNode; intro?: ReactNode; children?: ReactNode; tone?: 'white' | 'canvas' }) {
  return (
    <section aria-labelledby={id} className={clsx(tone === 'canvas' && 'bg-canvas border-y border-line')}>
      <Container className="py-16 sm:py-20">
        {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
        <h2 id={id} className="m-0 text-[30px] sm:text-[36px] leading-[1.1] font-bold tracking-[-0.02em] max-w-[820px]">{title}</h2>
        {intro && <p className="m-0 mt-4 text-[17px] text-ink-muted leading-relaxed max-w-[760px]">{intro}</p>}
        {children && <div className="mt-10">{children}</div>}
      </Container>
    </section>
  );
}

/** The closing call to action on each page. */
export function ClosingCta({ title = 'Start with an AI usage assessment. Nothing leaves your environment.' }: { title?: string }) {
  return (
    <section className="bg-ink text-white">
      <Container className="py-16 flex flex-wrap items-center justify-between gap-6">
        <h2 className="m-0 text-[30px] leading-[1.15] font-bold tracking-[-0.02em] max-w-[700px]">{title}</h2>
        <Link to="/contact" className="min-h-[48px] flex items-center px-6 rounded-lg bg-white text-ink font-semibold no-underline hover:bg-ink-tint">Book an assessment</Link>
      </Container>
    </section>
  );
}

/** A code sample. */
export function Code({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="m-0 my-4">
      {label && <figcaption className="text-xs text-ink-muted mb-1.5">{label}</figcaption>}
      <pre className="m-0 bg-ink text-[#E7ECF5] rounded-[10px] p-4 overflow-x-auto font-mono text-[13px] leading-relaxed"><code>{children}</code></pre>
    </figure>
  );
}
