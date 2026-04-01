import clsx from 'clsx';
import { useTheme } from '../../lib/theme';

interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  label?: string;
}

/**
 * sm = 32×16  thumb 12×12
 * md = 40×20  thumb 16×16
 */
export function Toggle({ checked, onChange, size = 'md', disabled = false, label }: ToggleProps) {
  const { isDark } = useTheme();
  const isSm = size === 'sm';

  /* track */
  const w = isSm ? 32 : 40;
  const h = isSm ? 16 : 20;
  /* thumb */
  const thumb = isSm ? 12 : 16;
  const pad = 2; // gap between thumb and track edge
  const onX = w - thumb - pad;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{ width: w, height: h }}
      className={clsx(
        'relative rounded-full transition-colors duration-200 flex-shrink-0 cursor-pointer',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
        isDark ? 'focus-visible:ring-offset-slate-900' : 'focus-visible:ring-offset-white',
        checked ? 'bg-brand-600' : (isDark ? 'bg-slate-700' : 'bg-gray-300'),
        disabled && 'opacity-40 cursor-not-allowed'
      )}
    >
      <span
        style={{
          width: thumb,
          height: thumb,
          top: (h - thumb) / 2,
          left: checked ? onX : pad,
        }}
        className="absolute rounded-full bg-white shadow-sm transition-[left] duration-200"
      />
    </button>
  );
}
