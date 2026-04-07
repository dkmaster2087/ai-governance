import clsx from 'clsx';
import { LucideIcon, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../lib/theme';
import { themeClasses } from '../../lib/theme-classes';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  color?: 'brand' | 'green' | 'red' | 'yellow';
  href?: string;
}

const colorConfig = {
  brand:  { bg: 'from-brand-500/20 to-brand-600/10', text: 'text-brand-400', glow: 'shadow-glow-brand' },
  green:  { bg: 'from-accent-500/20 to-accent-600/10', text: 'text-accent-400', glow: 'shadow-glow-accent' },
  red:    { bg: 'from-red-500/20 to-red-600/10', text: 'text-red-400', glow: '' },
  yellow: { bg: 'from-yellow-500/20 to-yellow-600/10', text: 'text-yellow-400', glow: '' },
};

export function StatCard({ label, value, sub, icon: Icon, trend, trendValue, color = 'brand', href }: StatCardProps) {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const c = colorConfig[color];

  const content = (
    <>
      <div className="flex items-start justify-between mb-4">
        <div className={clsx('w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center', c.bg)}>
          <Icon className={clsx('w-[18px] h-[18px]', c.text)} />
        </div>
        <div className="flex items-center gap-1.5">
          {trendValue && (
            <span className={clsx(
              'text-[11px] font-semibold px-2 py-0.5 rounded-full',
              trend === 'up' ? 'bg-accent-500/15 text-accent-400' :
              trend === 'down' ? 'bg-red-500/15 text-red-400' :
              clsx(isDark ? 'bg-white/[0.06] text-slate-400' : 'bg-gray-100 text-gray-500')
            )}>
              {trendValue}
            </span>
          )}
          {href && <ArrowUpRight className={clsx('w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5', t.faint)} />}
        </div>
      </div>
      <p className={clsx('text-2xl font-bold mb-1 animate-count-up', t.heading)}>{value}</p>
      <p className={clsx('text-[13px]', t.sub)}>{label}</p>
      {sub && <p className={clsx('text-[11px] mt-1', t.faint)}>{sub}</p>}
    </>
  );

  const cardClass = clsx(
    'group border rounded-2xl p-5 transition-all duration-300',
    t.card,
    isDark ? 'shadow-card-dark hover:shadow-card-dark-hover' : 'shadow-card hover:shadow-card-hover',
    'hover:-translate-y-0.5'
  );

  if (href) {
    return <Link to={href} className={clsx(cardClass, 'block')}>{content}</Link>;
  }
  return <div className={cardClass}>{content}</div>;
}
