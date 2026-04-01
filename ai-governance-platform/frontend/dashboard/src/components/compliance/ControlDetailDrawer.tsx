import { X, ShieldX, ShieldCheck, Copy, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { CONTROL_DETAILS } from '../../lib/control-details';
import { useTheme } from '../../lib/theme';
import { themeClasses } from '../../lib/theme-classes';

interface Props {
  controlId: string;
  controlTitle: string;
  severity: string;
  framework: string;
  onClose: () => void;
  onCopyToPolicy: (controlId: string) => void;
}

const severityColor: Record<string, string> = {
  critical: 'text-red-400 bg-red-500/10 border-red-500/20',
  high:     'text-orange-400 bg-orange-500/10 border-orange-500/20',
  medium:   'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  low:      'text-slate-400 bg-slate-700 border-slate-600',
};

export function ControlDetailDrawer({ controlId, controlTitle, severity, framework, onClose, onCopyToPolicy }: Props) {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const detail = CONTROL_DETAILS[controlId];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Drawer */}
      <div className={clsx('relative w-full max-w-lg border-l flex flex-col h-full overflow-hidden shadow-2xl', t.overlay, t.border)}>
        {/* Header */}
        <div className={clsx('flex items-start gap-3 px-6 py-5 border-b', t.border)}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={clsx('text-xs font-mono', t.muted)}>{controlId}</span>
              <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium border', severityColor[severity])}>
                {severity}
              </span>
              <span className={clsx('text-xs px-2 py-0.5 rounded-full', t.faint, isDark ? 'bg-slate-800' : 'bg-gray-100')}>{framework}</span>
            </div>
            <h2 className={clsx('font-semibold text-base leading-snug', t.heading)}>{controlTitle}</h2>
          </div>
          <button onClick={onClose} className={clsx(t.muted, t.hoverText, 'flex-shrink-0 mt-0.5')} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-6">
          {detail ? (
            <>
              {/* What it does */}
              <section>
                <h3 className={clsx('text-xs font-semibold uppercase tracking-wider mb-2', t.muted)}>What this control enforces</h3>
                <p className={clsx('text-sm leading-relaxed', t.body)}>{detail.what}</p>
              </section>

              {/* Why */}
              <section>
                <h3 className={clsx('text-xs font-semibold uppercase tracking-wider mb-2', t.muted)}>Regulatory rationale</h3>
                <p className={clsx('text-sm leading-relaxed', t.sub)}>{detail.why}</p>
              </section>

              {/* Blocked examples */}
              {detail.blockedExamples.length > 0 && (
                <section>
                  <h3 className={clsx('text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5', t.muted)}>
                    <ShieldX className="w-3.5 h-3.5 text-red-400" />
                    Prompts that would be blocked
                  </h3>
                  <ul className="space-y-2">
                    {detail.blockedExamples.map((ex, i) => (
                      <li key={i} className="flex items-start gap-2.5 bg-red-500/5 border border-red-500/15 rounded-lg px-3 py-2.5">
                        <ShieldX className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                        <span className={clsx('text-sm font-mono leading-relaxed', t.body)}>{ex}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Allowed examples */}
              {detail.allowedExamples.length > 0 && (
                <section>
                  <h3 className={clsx('text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5', t.muted)}>
                    <ShieldCheck className="w-3.5 h-3.5 text-accent-400" />
                    Prompts that would pass
                  </h3>
                  <ul className="space-y-2">
                    {detail.allowedExamples.map((ex, i) => (
                      <li key={i} className="flex items-start gap-2.5 bg-accent-500/5 border border-accent-500/15 rounded-lg px-3 py-2.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-accent-400 flex-shrink-0 mt-0.5" />
                        <span className={clsx('text-sm font-mono leading-relaxed', t.body)}>{ex}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Rule config preview */}
              <section>
                <h3 className={clsx('text-xs font-semibold uppercase tracking-wider mb-2', t.muted)}>Default rule configuration</h3>
                <pre className={clsx('border rounded-lg p-3 text-xs font-mono overflow-x-auto', t.deep, t.border, t.sub)}>
                  {JSON.stringify(detail.ruleConfig, null, 2)}
                </pre>
              </section>
            </>
          ) : (
            <div className={clsx('flex items-center gap-2 text-sm', t.muted)}>
              <AlertTriangle className="w-4 h-4" />
              Detailed documentation for this control is not yet available.
            </div>
          )}
        </div>

        {/* Footer action */}
        <div className={clsx('px-6 py-4 border-t', t.border)}>
          <button
            onClick={() => onCopyToPolicy(controlId)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
          >
            <Copy className="w-4 h-4" />
            Copy to Custom Policy
          </button>
        </div>
      </div>
    </div>
  );
}
