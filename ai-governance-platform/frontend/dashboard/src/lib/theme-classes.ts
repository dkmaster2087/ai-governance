/** Shared theme class map — call with isDark from useTheme() */
export function themeClasses(isDark: boolean) {
  return {
    // Surfaces
    card: isDark
      ? 'bg-[#0c1021]/90 backdrop-blur-sm border-white/[0.06]'
      : 'bg-white border-gray-200 shadow-card',
    cardSolid: isDark ? 'bg-[#0c1021] border-white/[0.06]' : 'bg-white border-gray-200',
    cardInner: isDark ? 'bg-white/[0.04]' : 'bg-gray-50/80',
    cardInnerHover: isDark
      ? 'bg-white/[0.04] hover:bg-white/[0.07]'
      : 'bg-gray-50/80 hover:bg-gray-100',
    overlay: isDark
      ? 'bg-[#0c1021] border-white/[0.06]'
      : 'bg-white border-gray-200',
    input: isDark
      ? 'bg-white/[0.05] border-white/[0.08] text-white placeholder-slate-500'
      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400',
    deep: isDark ? 'bg-[#060810]' : 'bg-gray-100',

    // Text
    heading: isDark ? 'text-white' : 'text-gray-900',
    body: isDark ? 'text-slate-300' : 'text-gray-600',
    sub: isDark ? 'text-slate-400' : 'text-gray-500',
    muted: isDark ? 'text-slate-500' : 'text-gray-400',
    faint: isDark ? 'text-slate-600' : 'text-gray-300',

    // Borders
    border: isDark ? 'border-white/[0.06]' : 'border-gray-200',
    borderLight: isDark ? 'border-white/[0.04]' : 'border-gray-100',
    divider: isDark ? 'divide-white/[0.04]' : 'divide-gray-200',

    // Interactive
    hoverRow: isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-gray-50',
    hoverText: isDark ? 'hover:text-white' : 'hover:text-gray-900',
    btnSecondary: isDark
      ? 'bg-white/[0.06] hover:bg-white/[0.1] text-slate-300'
      : 'bg-gray-100 hover:bg-gray-200 text-gray-600',
    btnGhost: isDark
      ? 'hover:bg-white/[0.06] text-slate-400'
      : 'hover:bg-gray-100 text-gray-500',

    // Misc
    track: isDark ? 'bg-white/[0.06]' : 'bg-gray-200',
    chip: isDark ? 'bg-white/[0.08] text-slate-300' : 'bg-gray-100 text-gray-600',
    chipMuted: isDark ? 'bg-white/[0.05] text-slate-400' : 'bg-gray-100 text-gray-500',

    // Glass
    glass: isDark
      ? 'bg-white/[0.03] backdrop-blur-xl border-white/[0.06]'
      : 'bg-white/60 backdrop-blur-xl border-gray-200/40',
  };
}
