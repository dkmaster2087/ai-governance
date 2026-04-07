import clsx from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { useTheme } from '../../lib/theme';
import { themeClasses } from '../../lib/theme-classes';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', confirmVariant = 'primary', onConfirm, onCancel }: Props) {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className={clsx('relative border rounded-2xl w-full max-w-md p-6 animate-slide-up', t.overlay, isDark ? 'shadow-card-dark-hover' : 'shadow-card-hover')}>
        <div className="flex items-start gap-4">
          <div className={clsx('w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br',
            confirmVariant === 'danger' ? 'from-red-500/20 to-red-600/10' : 'from-brand-500/20 to-brand-600/10'
          )}>
            <AlertTriangle className={clsx('w-5 h-5', confirmVariant === 'danger' ? 'text-red-400' : 'text-brand-400')} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={clsx('text-base font-semibold mb-1.5', t.heading)}>{title}</h3>
            <p className={clsx('text-sm leading-relaxed', t.sub)}>{message}</p>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className={clsx('flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-200', t.btnSecondary)}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={clsx('flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 text-white',
              confirmVariant === 'danger'
                ? 'bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400'
                : 'bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
