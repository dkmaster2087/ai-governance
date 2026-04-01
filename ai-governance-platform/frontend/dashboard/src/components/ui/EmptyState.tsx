import { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useTheme } from '../../lib/theme';
import { themeClasses } from '../../lib/theme-classes';

export function EmptyState({ icon: Icon, title, description }: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className={clsx('w-12 h-12 rounded-xl flex items-center justify-center mb-4', t.cardInner)}>
        <Icon className={clsx('w-6 h-6', t.muted)} />
      </div>
      <p className={clsx('font-medium mb-1', t.heading)}>{title}</p>
      {description && <p className={clsx('text-sm max-w-xs', t.muted)}>{description}</p>}
    </div>
  );
}
