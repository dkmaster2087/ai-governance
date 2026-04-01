/** Shared theme class map — call with isDark from useTheme() */
export function themeClasses(isDark: boolean) {
  return {
    card: isDark ? 'bg-slate-900 border-white/10' : 'bg-white border-gray-200',
    cardInner: isDark ? 'bg-slate-800' : 'bg-gray-100',
    cardInnerHover: isDark ? 'bg-slate-800/50 hover:bg-slate-800' : 'bg-gray-100 hover:bg-gray-200',
    overlay: isDark ? 'bg-slate-900 border-white/10' : 'bg-white border-gray-200',
    input: isDark
      ? 'bg-slate-800 border-white/10 text-white placeholder-slate-600'
      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400',
    deep: isDark ? 'bg-slate-950' : 'bg-gray-50',
    heading: isDark ? 'text-white' : 'text-gray-900',
    body: isDark ? 'text-slate-300' : 'text-gray-700',
    sub: isDark ? 'text-slate-400' : 'text-gray-500',
    muted: isDark ? 'text-slate-500' : 'text-gray-400',
    faint: isDark ? 'text-slate-600' : 'text-gray-300',
    border: isDark ? 'border-white/10' : 'border-gray-200',
    borderLight: isDark ? 'border-white/5' : 'border-gray-100',
    divider: isDark ? 'divide-white/5' : 'divide-gray-100',
    hoverRow: isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50',
    hoverText: isDark ? 'hover:text-white' : 'hover:text-gray-900',
    btnSecondary: isDark
      ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
      : 'bg-gray-100 hover:bg-gray-200 text-gray-700',
    track: isDark ? 'bg-slate-800' : 'bg-gray-200',
    chip: isDark ? 'bg-slate-700 text-slate-300' : 'bg-gray-200 text-gray-600',
    chipMuted: isDark ? 'bg-slate-800 text-slate-400' : 'bg-gray-100 text-gray-500',
  };
}
