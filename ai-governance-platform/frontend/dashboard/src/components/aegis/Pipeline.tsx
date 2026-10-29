import clsx from 'clsx';
import type { GatewaySummary } from '../../lib/gateway-api';
import { formatCount } from './primitives';

interface Check {
  n: number;
  name: string;
  what: string;
  active: boolean;
  /** What dropped out under this check. */
  drop: { count: number; verb: string; detail: string; kind: 'stopped' | 'cleaned' | 'inactive' };
}

function Lane({ count }: { count: number }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-1.5">
      <span className="font-mono text-[13px] font-medium">{formatCount(count)}</span>
      <div className="flex items-center w-full" aria-hidden="true">
        <div className="flex-1 h-2.5 bg-ink rounded-l-[5px]" />
        <div className="w-0 h-0 border-y-[10px] border-y-transparent border-l-[13px] border-l-ink" />
      </div>
    </div>
  );
}

function List({ title, items }: { title: string; items: Array<{ name: string; count: number }> }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-muted mb-1">{title}</span>
      {items.length === 0 ? (
        <span className="text-ink-muted py-1.5">None yet</span>
      ) : (
        items.map((i) => (
          <div key={i.name} className="flex justify-between gap-2 border-b border-line-subtle py-1.5">
            <span className="font-semibold truncate">{i.name}</span>
            <span className="font-mono text-xs text-ink-muted">{formatCount(i.count)}</span>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * The gateway as a picture: apps on the left, the checks every request passes in order,
 * and providers on the right. Whatever a check stops drops out beneath it in red.
 */
export function Pipeline({ summary }: { summary: GatewaySummary }) {
  const { checks } = summary;
  const afterPolicy = summary.received - checks.policy.stopped;
  const afterSecrets = afterPolicy - checks.secrets.stopped;

  const stages: Check[] = [
    {
      n: 1, name: 'Policy rules', what: 'your keyword, model and data rules', active: true,
      drop: { count: checks.policy.stopped, verb: 'stopped', detail: 'by your policy rules', kind: 'stopped' },
    },
    {
      n: 2, name: 'Secrets', what: 'API keys, tokens, private keys', active: checks.secrets.active,
      drop: checks.secrets.active
        ? { count: checks.secrets.stopped, verb: 'stopped', detail: 'credentials in prompts', kind: 'stopped' }
        : { count: 0, verb: 'Not active yet', detail: 'secrets detection is coming soon', kind: 'inactive' },
    },
    {
      n: 3, name: 'Personal data', what: 'email, phone, SSN, card numbers', active: true,
      drop: { count: checks.personalData.cleaned, verb: 'cleaned, then sent', detail: 'personal data removed in place', kind: 'cleaned' },
    },
  ];
  const lanes = [summary.received, afterPolicy, afterSecrets, summary.delivered];

  return (
    <div className="overflow-x-auto">
      <div
        className="grid items-center min-w-[1180px]"
        style={{
          gridTemplateColumns: '210px minmax(56px,1fr) 170px minmax(56px,1fr) 170px minmax(56px,1fr) 170px minmax(56px,1fr) 210px',
          gridTemplateRows: 'minmax(220px, auto) 170px',
        }}
      >
        <div style={{ gridColumn: 1, gridRow: 1 }}>
          <List title="Coming in" items={summary.sources} />
        </div>
        {lanes.map((count, i) => (
          <div key={i} style={{ gridColumn: 2 + i * 2, gridRow: 1 }}>
            <Lane count={count} />
          </div>
        ))}
        {stages.map((c, i) => (
          <div key={c.n} className="contents">
            <div style={{ gridColumn: 3 + i * 2, gridRow: 1 }} className="self-stretch flex flex-col justify-center">
              <div
                className={clsx(
                  'rounded-xl p-4 min-h-[150px] flex flex-col justify-between gap-2.5',
                  c.active ? 'bg-ink text-white' : 'bg-white text-ink border-2 border-dashed border-line-strong'
                )}
              >
                <span className={clsx('font-mono text-xs', c.active ? 'text-ink-on-dark-muted' : 'text-ink-muted')}>check {c.n}</span>
                <span className="text-xl font-bold leading-tight">{c.name}</span>
                <span className={clsx('text-xs', c.active ? 'text-ink-on-dark' : 'text-ink-muted')}>{c.what}</span>
              </div>
            </div>
            <div style={{ gridColumn: 3 + i * 2, gridRow: 2 }} className="self-start flex flex-col items-center text-center">
              <div
                aria-hidden="true"
                className={clsx(
                  'w-0 h-12 border-l-[3px]',
                  c.drop.kind === 'stopped' && 'border-stop',
                  c.drop.kind === 'cleaned' && 'border-dashed border-ink',
                  c.drop.kind === 'inactive' && 'border-dotted border-line-strong'
                )}
              />
              {c.drop.kind === 'inactive' ? (
                <div className="pt-2 font-semibold text-ink-muted">{c.drop.verb}</div>
              ) : (
                <div className={clsx('pt-1.5 text-[38px] font-extrabold leading-none tracking-[-0.03em]', c.drop.kind === 'stopped' ? 'text-stop' : 'text-ink')}>
                  {formatCount(c.drop.count)}
                </div>
              )}
              {c.drop.kind !== 'inactive' && (
                <div className={clsx('mt-1 font-semibold', c.drop.kind === 'stopped' ? 'text-stop' : 'text-ink')}>{c.drop.verb}</div>
              )}
              <div className="mt-0.5 text-xs text-ink-muted">{c.drop.detail}</div>
            </div>
          </div>
        ))}
        <div style={{ gridColumn: 9, gridRow: 1 }} className="pl-2">
          <List title="Delivered to" items={summary.providers} />
        </div>
      </div>
    </div>
  );
}
