/**
 * Picture-first building blocks for the sales site: drawn icons, the source gallery, icon facts and steps.
 * Vendor names are written as text next to generic icons; no vendor logos are used.
 */
import { ReactNode } from 'react';
import clsx from 'clsx';
import { Status } from './ui';

type IconName = 'key' | 'cloud' | 'firewall' | 'web' | 'dns' | 'identity' | 'apps' | 'browser' | 'lock' | 'eye' | 'code' | 'trash' | 'offline' | 'server' | 'report' | 'plug' | 'clock';

const PATHS: Record<IconName, ReactNode> = {
  key: <><circle cx="8" cy="15" r="4.5" /><path d="M11.2 11.8L20 3M16.5 6.5l2.5 2.5M14 9l2 2" /></>,
  cloud: <path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 9.5 4.25 4.25 0 0 0 7 18z" />,
  firewall: <><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 9.7v4.6M9 14.3V19" /></>,
  web: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17" /></>,
  dns: <><rect x="4" y="4" width="16" height="6" rx="1.5" /><rect x="4" y="14" width="16" height="6" rx="1.5" /><path d="M8 7h.01M8 17h.01M12 7h4M12 17h4" /></>,
  identity: <><circle cx="9" cy="9" r="3.5" /><path d="M3 19c.6-3 3-4.5 6-4.5s5.4 1.5 6 4.5M16 8h5M18.5 5.5v5" /></>,
  apps: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  browser: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M3 9h18M6.5 6.8h.01M9 6.8h.01" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  code: <><circle cx="12" cy="9" r="4" /><path d="M5 20c1-3.5 3.8-5 7-5s6 1.5 7 5" /><path d="M16.5 4.5l3 3M19.5 4.5l-3 3" /></>,
  trash: <><path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13" /></>,
  offline: <><path d="M3 3l18 18M8.5 8.7A6 6 0 0 0 6.1 9.5 4.25 4.25 0 0 0 7 18h10.5M13 6.2a6 6 0 0 1 4.6 3.84A4 4 0 0 1 20.4 16" /></>,
  server: <><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M4 9.5h16M4 15h16M8 6.5h.01M8 12h.01M8 18h.01" /></>,
  report: <><path d="M6 3.5h9l3 3V20.5H6z" /><path d="M9 11h6M9 14.5h6M9 18h3" /></>,
  plug: <><path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={clsx('w-7 h-7', className)}>
      {PATHS[name]}
    </svg>
  );
}

export interface Source { name: string; icon: IconName; kind: string; sees: string; status: 'Available' | 'Beta' | 'Coming' }

export const SOURCES: Source[] = [
  { name: 'AWS', icon: 'cloud', kind: 'Cloud', sees: 'DNS, firewall, Bedrock calls', status: 'Available' },
  { name: 'Microsoft Azure', icon: 'cloud', kind: 'Cloud', sees: 'DNS, firewall, Azure OpenAI', status: 'Coming' },
  { name: 'Google Cloud', icon: 'cloud', kind: 'Cloud', sees: 'DNS, firewall, Vertex AI', status: 'Coming' },
  { name: 'Palo Alto Networks', icon: 'firewall', kind: 'Firewall', sees: 'URL filtering', status: 'Available' },
  { name: 'Fortinet FortiGate', icon: 'firewall', kind: 'Firewall', sees: 'Web filter, DNS', status: 'Available' },
  { name: 'Check Point', icon: 'firewall', kind: 'Firewall', sees: 'URL filtering (CEF)', status: 'Available' },
  { name: 'Zscaler', icon: 'web', kind: 'Web gateway', sees: 'Every laptop, anywhere', status: 'Coming' },
  { name: 'Netskope', icon: 'web', kind: 'Web gateway', sees: 'Every laptop, anywhere', status: 'Coming' },
  { name: 'Squid', icon: 'web', kind: 'Proxy', sees: 'Web traffic', status: 'Available' },
  { name: 'BIND · Windows DNS', icon: 'dns', kind: 'DNS servers', sees: 'Lookups', status: 'Available' },
  { name: 'Microsoft 365', icon: 'apps', kind: 'Work apps', sees: 'Copilot use', status: 'Coming' },
  { name: 'Google Workspace', icon: 'apps', kind: 'Work apps', sees: 'Gemini use', status: 'Coming' },
  { name: 'Okta', icon: 'identity', kind: 'Identity', sees: 'Sign-ins to AI tools', status: 'Coming' },
  { name: 'Microsoft Entra', icon: 'identity', kind: 'Identity', sees: 'Sign-ins to AI tools', status: 'Coming' },
  { name: 'Chrome', icon: 'browser', kind: 'Browser', sees: 'AI sites people open', status: 'Beta' },
];

/** Every place the assessment can read from, as tiles. */
export function SourceGallery({ limit }: { limit?: number }) {
  const list = limit ? SOURCES.slice(0, limit) : SOURCES;
  return (
    <ul className="m-0 p-0 list-none grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
      {list.map((s) => (
        <li key={s.name} className={clsx('rounded-[14px] p-4 flex flex-col gap-2.5 bg-white', s.status === 'Coming' ? 'border border-dashed border-line-strong' : 'border border-line')}>
          <div className="flex items-start justify-between gap-2">
            <span className={clsx('w-11 h-11 rounded-xl flex items-center justify-center', s.status === 'Coming' ? 'bg-canvas text-ink-muted' : 'bg-ink text-white')}>
              <Icon name={s.icon} className="w-6 h-6" />
            </span>
            <Status value={s.status} />
          </div>
          <div>
            <div className="font-bold leading-tight">{s.name}</div>
            <div className="text-[13px] text-ink-muted mt-0.5">{s.kind} · {s.sees}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A row of icon facts: a few words each. */
export function IconFacts({ items, dark = false }: { items: Array<[IconName, string, string?]>; dark?: boolean }) {
  return (
    <ul className="m-0 p-0 list-none grid gap-x-6 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
      {items.map(([icon, title, sub]) => (
        <li key={title} className="flex flex-col gap-2">
          <Icon name={icon} className={clsx('w-8 h-8', dark ? 'text-white' : 'text-ink')} />
          <span className="font-bold text-[17px] leading-snug">{title}</span>
          {sub && <span className={clsx('text-sm', dark ? 'text-ink-on-dark' : 'text-ink-muted')}>{sub}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Numbered steps on a line. */
export function Steps({ items }: { items: Array<{ when: string; title: string; status?: 'Available' | 'Beta' | 'Coming' }> }) {
  return (
    <ol className="m-0 p-0 list-none grid gap-0" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))` }}>
      {items.map((s, i) => (
        <li key={s.title} className="relative pt-9 pr-4 pb-4">
          <div aria-hidden="true" className={clsx('absolute top-[15px] left-0 right-0 h-[2px]', s.status === 'Coming' ? 'border-t-2 border-dashed border-line-strong' : 'bg-ink')} />
          <span className={clsx('absolute top-0 left-0 w-8 h-8 rounded-full flex items-center justify-center font-mono text-sm font-semibold',
            s.status === 'Coming' ? 'bg-white border-2 border-dashed border-line-strong text-ink-muted' : 'bg-ink text-white')}>{i + 1}</span>
          <div className="font-mono text-xs text-ink-muted mt-2">{s.when}</div>
          <div className="font-bold leading-snug mt-1">{s.title}</div>
          {s.status && s.status !== 'Available' && <Status value={s.status} className="mt-2" />}
        </li>
      ))}
    </ol>
  );
}

/** Who runs what in each deployment model, as two zones. */
export function DeploymentPicture({ ours, theirs }: { ours: string[]; theirs: string[] }) {
  const zone = (title: string, items: string[], dark: boolean) => (
    <div className={clsx('rounded-xl p-3 flex flex-col gap-1.5 min-h-[128px]', dark ? 'bg-ink text-white' : 'bg-white border-2 border-ink')}>
      <span className={clsx('text-[11px] font-semibold uppercase tracking-[0.06em]', dark ? 'text-ink-on-dark' : 'text-ink-muted')}>{title}</span>
      {items.length === 0
        ? <span className={clsx('text-sm', dark ? 'text-ink-on-dark' : 'text-ink-muted')}>Nothing</span>
        : items.map((x) => <span key={x} className={clsx('text-[13px] font-semibold rounded-md px-2 py-1', dark ? 'bg-white/10' : 'bg-ink-tint')}>{x}</span>)}
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-2" aria-label={`Probaline runs: ${ours.join(', ') || 'nothing'}. You run: ${theirs.join(', ') || 'nothing'}.`}>
      {zone('Probaline runs', ours, true)}
      {zone('You run', theirs, false)}
    </div>
  );
}
