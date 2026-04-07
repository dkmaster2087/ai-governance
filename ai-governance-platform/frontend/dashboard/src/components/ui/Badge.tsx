import clsx from 'clsx';
import { useTheme } from '../../lib/theme';

type BadgeVariant = 'allow' | 'block' | 'warn' | 'mask' | 'neutral';

const variants: Record<BadgeVariant, string> = {
  allow: 'bg-accent-500/15 text-accent-400 ring-accent-500/20',
  block: 'bg-red-500/15 text-red-400 ring-red-500/20',
  warn: 'bg-yellow-500/15 text-yellow-400 ring-yellow-500/20',
  mask: 'bg-blue-500/15 text-blue-400 ring-blue-500/20',
  neutral: '',
};

export function Badge({ label, variant = 'neutral' }: { label: string; variant?: BadgeVariant }) {
  const { isDark } = useTheme();
  const cls = variant === 'neutral'
    ? (isDark ? 'bg-white/[0.06] text-slate-400 ring-white/[0.06]' : 'bg-gray-100 text-gray-500 ring-gray-200/60')
    : variants[variant];

  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-semibold ring-1', cls)}>
      {label}
    </span>
  );
}
