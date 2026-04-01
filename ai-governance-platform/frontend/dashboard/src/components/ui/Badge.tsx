import clsx from 'clsx';
import { useTheme } from '../../lib/theme';

type BadgeVariant = 'allow' | 'block' | 'warn' | 'mask' | 'neutral';

const variants: Record<BadgeVariant, string> = {
  allow: 'bg-accent-500/20 text-accent-400',
  block: 'bg-red-500/20 text-red-400',
  warn: 'bg-yellow-500/20 text-yellow-400',
  mask: 'bg-blue-500/20 text-blue-400',
  neutral: '', // handled dynamically
};

export function Badge({ label, variant = 'neutral' }: { label: string; variant?: BadgeVariant }) {
  const { isDark } = useTheme();
  const cls = variant === 'neutral'
    ? (isDark ? 'bg-slate-700 text-slate-400' : 'bg-gray-200 text-gray-500')
    : variants[variant];

  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', cls)}>
      {label}
    </span>
  );
}
