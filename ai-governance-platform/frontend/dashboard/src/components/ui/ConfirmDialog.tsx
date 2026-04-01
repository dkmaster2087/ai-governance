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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className={clsx('relative border rounded-2xl w-full max-w-md shadow-2xl p-6', t.overlay)}>
        <div className="flex items-start gap-4">
          <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
            confirmVariant === 'danger' ? 'bg-red-500/20' : 'bg-brand-600/20'
          )}>
            <AlertTriangle className={clsx('w-5 h-5', confirmVariant === 'danger' ? 'text-red-400' : 'text-brand-400')} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={clsx('text-base font-semibold mb-1', t.heading)}>{title}</h3>
            <p className={clsx('text-sm leading-relaxed', t.sub)}>{message}</p>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className={clsx('flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors', t.btnSecondary)}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={clsx('flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors text-white',
              confirmVariant === 'danger' ? 'bg-red-600 hover:bg-red-500' : 'bg-brand-600 hover:bg-brand-500'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
