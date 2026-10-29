/**
 * Core building blocks for the Aegis UI (direction I): light, ink navy, red only for "stopped".
 * Keep pages composed from these so the look stays consistent.
 */
import { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, LinkProps } from 'react-router-dom';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'ghost';

const buttonBase =
  'inline-flex items-center justify-center gap-2 min-h-[40px] px-3.5 rounded-lg text-sm transition-colors ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50';

const buttonVariants: Record<Variant, string> = {
  primary: 'bg-ink text-white font-semibold hover:bg-[#1E2F54]',
  secondary: 'bg-white text-ink border border-line-strong hover:border-ink-faint',
  ghost: 'text-ink-muted hover:text-ink',
};

export function Button({ variant = 'primary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={clsx(buttonBase, buttonVariants[variant], className)} {...props} />;
}

/** A navigation action styled as a button. */
export function ButtonLink({ variant = 'primary', className, ...props }: LinkProps & { variant?: Variant }) {
  return <Link className={clsx(buttonBase, buttonVariants[variant], 'no-underline', className)} {...props} />;
}

/** An inline "→" text link. */
export function ArrowLink({ className, children, ...props }: LinkProps) {
  return (
    <Link className={clsx('inline-flex items-center min-h-[36px] font-semibold text-ink hover:text-stop', className)} {...props}>
      {children} <span aria-hidden="true" className="ml-1">→</span>
    </Link>
  );
}

export function Panel({ className, children, as: Tag = 'section', ...rest }: { className?: string; children: ReactNode; as?: 'section' | 'article' | 'div' | 'aside'; 'aria-label'?: string }) {
  return (
    <Tag className={clsx('bg-white border border-line rounded-[14px]', className)} {...rest}>
      {children}
    </Tag>
  );
}

/** Small uppercase label used above sections. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={clsx('m-0 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted', className)}>{children}</h2>;
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/** A row of mutually exclusive buttons (time range, modes). */
export function Segmented<T extends string>({
  options, value, onChange, label,
}: { options: SegmentedOption<T>[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex border border-line-strong rounded-lg overflow-hidden bg-white">
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={clsx(
              'min-h-[38px] px-3.5 text-sm',
              i > 0 && 'border-l border-line-strong',
              active ? 'bg-ink text-white font-semibold' : 'text-ink-muted hover:text-ink'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Calm empty or not-available-yet message. Never fake data in its place. */
export function Note({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="py-6">
      <p className="m-0 font-semibold text-ink">{title}</p>
      {children && <p className="m-0 mt-1 text-ink-muted">{children}</p>}
    </div>
  );
}

export const formatCount = (n: number) => n.toLocaleString('en-US');

/** An on/off switch. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'flex-none w-11 h-[26px] rounded-full p-[3px] flex transition-colors disabled:opacity-50',
        checked ? 'bg-ink justify-end' : 'bg-[#B8C0CC] justify-start'
      )}
    >
      <span className="w-5 h-5 rounded-full bg-white" />
    </button>
  );
}
