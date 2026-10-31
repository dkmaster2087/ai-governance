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

function Lane({ count }: { count: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-1">
      <span className="font-mono text-[12px] sm:text-[13px] font-medium">{count}</span>
      <div className="flex items-center w-full" aria-hidden="true">
        <div className="flex-1 h-2 bg-ink rounded-l" />
        <div className="w-0 h-0 border-y-[8px] border-y-transparent border-l-[11px] border-l-ink" />
      </div>
    </div>
  );
}

/**
 * The product in one picture: apps on the left, the checks every request passes, providers on the right.
 * Example numbers only; labelled as such wherever it's used.
 */
export function PipelineIllustration() {
  const checks = [
    { n: 1, name: 'Policy rules', what: 'your words, patterns and approved models', drop: '225', verb: 'stopped', kind: 'stop' as const },
    { n: 2, name: 'Secrets', what: 'API keys, tokens, private keys', drop: 'soon', verb: 'coming next', kind: 'soon' as const },
    { n: 3, name: 'Personal data', what: 'emails, phone, SSN, card numbers', drop: '1,184', verb: 'cleaned, then sent', kind: 'clean' as const },
  ];
  return (
    <figure className="m-0" aria-label="Example: 43,012 requests come in from apps, 225 are stopped by policy rules, 1,184 have personal data removed, and 42,787 reach AI providers.">
      <div className="overflow-x-auto">
        <div className="grid items-center min-w-[900px]" style={{ gridTemplateColumns: '150px minmax(40px,1fr) 150px minmax(40px,1fr) 150px minmax(40px,1fr) 150px minmax(40px,1fr) 150px', gridTemplateRows: 'auto 150px' }}>
          <div style={{ gridColumn: 1, gridRow: 1 }} className="flex flex-col gap-1 text-[13px]">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted mb-1">Coming in</span>
            {['support-bot', 'billing-api', 'Cursor (IDE)', 'hr-assistant'].map((a) => (
              <span key={a} className="font-semibold border-b border-line-subtle py-1">{a}</span>
            ))}
          </div>
          {['43,012', '42,787', '42,787', '42,787'].map((c, i) => (
            <div key={i} style={{ gridColumn: 2 + i * 2, gridRow: 1 }}><Lane count={c} /></div>
          ))}
          {checks.map((c, i) => (
            <div key={c.n} className="contents">
              <div style={{ gridColumn: 3 + i * 2, gridRow: 1 }}
                className={clsx('rounded-xl p-3.5 min-h-[128px] flex flex-col justify-between gap-2', c.kind === 'soon' ? 'bg-white border-2 border-dashed border-line-strong' : 'bg-ink text-white')}>
                <span className={clsx('font-mono text-[11px]', c.kind === 'soon' ? 'text-ink-muted' : 'text-ink-on-dark-muted')}>check {c.n}</span>
                <span className="text-[17px] font-bold leading-tight">{c.name}</span>
                <span className={clsx('text-[11px]', c.kind === 'soon' ? 'text-ink-muted' : 'text-ink-on-dark')}>{c.what}</span>
              </div>
              <div style={{ gridColumn: 3 + i * 2, gridRow: 2 }} className="self-start flex flex-col items-center text-center">
                <div aria-hidden="true" className={clsx('w-0 h-10 border-l-[3px]', c.kind === 'stop' && 'border-stop', c.kind === 'clean' && 'border-dashed border-ink', c.kind === 'soon' && 'border-dotted border-line-strong')} />
                {c.kind === 'soon'
                  ? <span className="pt-2 font-semibold text-ink-muted">{c.verb}</span>
                  : <>
                      <span className={clsx('pt-1 text-[32px] font-extrabold leading-none tracking-[-0.03em]', c.kind === 'stop' ? 'text-stop' : 'text-ink')}>{c.drop}</span>
                      <span className={clsx('mt-1 text-sm font-semibold', c.kind === 'stop' ? 'text-stop' : 'text-ink')}>{c.verb}</span>
                    </>}
              </div>
            </div>
          ))}
          <div style={{ gridColumn: 9, gridRow: 1 }} className="flex flex-col gap-1 text-[13px] pl-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted mb-1">Delivered to</span>
            {['Amazon Bedrock', 'OpenAI', 'Anthropic'].map((p) => (
              <span key={p} className="font-semibold border-b border-line-subtle py-1">{p}</span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="mt-2 text-xs text-ink-muted">Example week. Red: stopped at the gateway. Dashed: personal data removed, then sent on.</figcaption>
    </figure>
  );
}

/** A code sample in the docs. */
export function Code({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="m-0 my-4">
      {label && <figcaption className="text-xs text-ink-muted mb-1.5">{label}</figcaption>}
      <pre className="m-0 bg-ink text-[#E7ECF5] rounded-[10px] p-4 overflow-x-auto font-mono text-[13px] leading-relaxed"><code>{children}</code></pre>
    </figure>
  );
}
