import clsx from 'clsx';
import { useTheme } from '../../lib/theme';

interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  label?: string;
}

export function Toggle({ checked, onChange, size = 'md', disabled = false, label }: ToggleProps) {
  const { isDark } = useTheme();
  const isSm = size === 'sm';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={clsx(
        'inline-flex items-center rounded-full transition-colors duration-200 flex-shrink-0',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
        isDark ? 'focus-visible:ring-offset-slate-900' : 'focus-visible:ring-offset-white',
        isSm ? 'w-8 h-[18px]' : 'w-10 h-[22px]',
        checked ? 'bg-brand-600' : (isDark ? 'bg-slate-700' : 'bg-gray-300'),
        disabled && 'opacity-40 cursor-not-allowed'
      )}
    >
      <span
        className={clsx(
          'inline-block rounded-full bg-white shadow-sm transition-transform duration-200',
          isSm ? 'w-3.5 h-3.5' : 'w-4 h-4',
          checked
            ? (isSm ? 'translate-x-[14px]' : 'translate-x-[20px]')
            : 'translate-x-[2px]'
        )}
      />
    </button>
  );
}
