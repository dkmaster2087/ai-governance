import clsx from 'clsx';
import { LucideIcon } from 'lucide-react';
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
}

const colorMap = {
  brand: 'bg-brand-600/20 text-brand-400',
  green: 'bg-accent-500/20 text-accent-400',
  red: 'bg-red-500/20 text-red-400',
  yellow: 'bg-yellow-500/20 text-yellow-400',
};

export function StatCard({ label, value, sub, icon: Icon, trend, trendValue, color = 'brand' }: StatCardProps) {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);

  return (
    <div className={clsx('border rounded-xl p-5', t.card)}>
      <div className="flex items-start justify-between mb-4">
        <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center', colorMap[color])}>
          <Icon className="w-4 h-4" />
        </div>
        {trendValue && (
          <span className={clsx(
            'text-xs font-medium px-2 py-0.5 rounded-full',
            trend === 'up' ? 'bg-accent-500/20 text-accent-400' :
            trend === 'down' ? 'bg-red-500/20 text-red-400' :
            clsx(isDark ? 'bg-slate-700 text-slate-400' : 'bg-gray-200 text-gray-500')
          )}>
            {trendValue}
          </span>
        )}
      </div>
      <p className={clsx('text-2xl font-bold mb-1', t.heading)}>{value}</p>
      <p className={clsx('text-sm', t.sub)}>{label}</p>
      {sub && <p className={clsx('text-xs mt-1', t.faint)}>{sub}</p>}
    </div>
  );
}
