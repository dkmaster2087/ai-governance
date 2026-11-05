import clsx from 'clsx';

/**
 * The Probaline mark: a bar, one true line and a brass plumb bob.
 * The line takes the text color; the bob is always brass (lighter brass on dark backgrounds).
 */
export function PlumbMark({ size = 22, onDark = false, className }: { size?: number; onDark?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path d="M10.5 4.5h11M16 4.5v13.4" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path
        d="M16 17.6L20.2 22.6L16 29L11.8 22.6Z"
        className={clsx(onDark ? 'fill-brass-on-dark stroke-brass-on-dark' : 'fill-brass stroke-brass')}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
