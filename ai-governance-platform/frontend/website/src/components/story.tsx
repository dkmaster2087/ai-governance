import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Panel, Status } from './ui';

/** The customer journey in three phases. Used on the home page and How it works. */
export const PHASES = [
  {
    n: 1,
    name: 'Inspect',
    title: 'Find every AI service your company already uses.',
    body: 'Read-only collectors run inside your environment and read the logs you already have: cloud DNS and audit logs, firewalls, proxies and DNS servers. In two to four weeks you get a report of who uses which AI services, from where, and how much.',
    points: ['Nothing in your traffic path', 'The report is built in your environment', 'People shown as codes; names stay with you'],
    to: '/assessment',
    link: 'How the assessment works',
    status: 'Available' as const,
  },
  {
    n: 2,
    name: 'Protect',
    title: 'Route AI traffic through a gateway you control.',
    body: 'Apps, developers’ IDEs and browsers reach AI through Aegis. Every request is checked before it leaves: confidential material is stopped, personal data is removed, and each decision is kept as evidence.',
    points: ['One address change per app', 'Stops, masks and records in real time', 'Streaming answers supported'],
    to: '/gateway',
    link: 'What the gateway does',
    status: 'Available' as const,
  },
  {
    n: 3,
    name: 'Enforce and prove',
    title: 'Close the other paths, and show it’s working.',
    body: 'Aegis writes the cloud and firewall rules that block AI services except through the gateway, and keeps measuring the share of AI traffic that goes through it, so you can show your board the number.',
    points: ['Rules start in report-only mode', 'Every path still open, with its fix', 'A trend from day one'],
    to: '/how-it-works#enforce',
    link: 'How enforcement works',
    status: 'Coming' as const,
  },
];

export function PhaseCards({ compact = false }: { compact?: boolean }) {
  return (
    <ol className="m-0 p-0 list-none grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
      {PHASES.map((p) => (
        <li key={p.n}>
          <Panel className="h-full p-6 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-sm text-ink-muted">Phase {p.n}</span>
              <Status value={p.status} />
            </div>
            <h3 className="m-0 text-[26px] font-bold tracking-[-0.02em]">{p.name}</h3>
            <p className="m-0 text-[17px] font-semibold leading-snug">{p.title}</p>
            {!compact && <p className="m-0 text-ink-muted leading-relaxed">{p.body}</p>}
            <ul className="m-0 pl-5 flex flex-col gap-1 text-[15px]">{p.points.map((x) => <li key={x}>{x}</li>)}</ul>
            <Link to={p.to} className="mt-auto pt-2 font-semibold text-ink hover:text-stop no-underline">{p.link} →</Link>
          </Panel>
        </li>
      ))}
    </ol>
  );
}

/** A trimmed copy of the assessment report, with made-up numbers. */
export function SampleReport({ className }: { className?: string }) {
  const recs = [
    { pri: 'Do first', red: true, text: 'Route 6 servers that call model APIs directly through Aegis', detail: 'One address change per app puts all direct model-API traffic under policy.' },
    { pri: 'Do first', red: true, text: 'Put Amazon Bedrock behind the gateway', detail: '3 identities call it directly, with no policy on their prompts.' },
    { pri: 'Next', red: false, text: 'Block 4 AI services with no business data terms on record', detail: 'DeepSeek, Grok, Otter.ai, DeepSeek API.' },
  ];
  const stats = [['13', 'AI services'], ['47', 'servers and devices'], ['212', 'people'], ['12,035', 'lookups and calls']];
  return (
    <figure className={clsx('m-0', className)}>
      <Panel className="p-6 sm:p-8 bg-canvas">
        <p className="m-0 text-xs text-ink-muted">AI usage assessment · Example Corp · 21 days</p>
        <p className="m-0 mt-2 text-[24px] sm:text-[28px] leading-[1.15] font-bold tracking-[-0.02em]">13 AI services used from 47 servers and devices and 212 people.</p>
        <p className="m-0 mt-2"><span className="text-stop font-semibold">4 services have no business data terms on record.</span> 6 servers call model APIs directly, with no policy in the way.</p>
        <div className="mt-5 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
          {stats.map(([v, l]) => (
            <div key={l} className="bg-white border border-line rounded-xl px-4 py-3"><div className="text-[22px] font-bold">{v}</div><div className="text-xs text-ink-muted">{l}</div></div>
          ))}
        </div>
        <p className="m-0 mt-6 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Recommendations</p>
        <ul className="m-0 mt-2 p-0 list-none flex flex-col gap-2.5">
          {recs.map((r) => (
            <li key={r.text} className={clsx('bg-white border border-line rounded-xl px-4 py-3', r.red && 'border-l-4 border-l-stop')}>
              <span className={clsx('text-[11px] font-semibold uppercase tracking-[0.05em]', r.red ? 'text-stop' : 'text-ink-muted')}>{r.pri}</span>
              <p className="m-0 font-semibold">{r.text}</p>
              <p className="m-0 text-sm text-ink-muted">{r.detail}</p>
            </li>
          ))}
        </ul>
      </Panel>
      <figcaption className="mt-2 text-xs text-ink-muted">Example report with made-up numbers. Yours is built inside your environment.</figcaption>
    </figure>
  );
}
