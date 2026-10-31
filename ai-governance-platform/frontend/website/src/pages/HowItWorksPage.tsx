import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { ClosingCta, Container, PageHeader, Panel, Section, Status } from '../components/ui';
import { PhaseCards } from '../components/story';
import { Icon, Steps } from '../components/visuals';

export const JOURNEY: Array<{ when: string; title: string; status: 'Available' | 'Beta' | 'Coming' }> = [
  { when: 'Week 0', title: 'Install read-only collectors', status: 'Available' },
  { when: 'Weeks 1–4', title: 'Collect', status: 'Available' },
  { when: 'Week 4', title: 'Read the report together', status: 'Available' },
  { when: 'Weeks 4–8', title: 'Route apps, IDEs and browsers through Aegis', status: 'Available' },
  { when: 'From week 8', title: 'Lock the other paths, report-only first', status: 'Coming' },
  { when: 'Ongoing', title: 'Measure the share through Aegis', status: 'Coming' },
];

const LOCKS: Array<{ icon: 'cloud' | 'firewall' | 'browser' | 'report'; title: string; sub: string; status: 'Beta' | 'Coming' }> = [
  { icon: 'cloud', title: 'Cloud policies', sub: 'Model calls only from the gateway', status: 'Coming' },
  { icon: 'firewall', title: 'Firewall feed', sub: 'AI domains blocked except via Aegis', status: 'Coming' },
  { icon: 'browser', title: 'Browser extension', sub: 'Unapproved tools blocked', status: 'Beta' },
  { icon: 'report', title: 'Proof', sub: 'Share of AI traffic through Aegis', status: 'Coming' },
];

export function HowItWorksPage() {
  const { hash } = useLocation();
  useEffect(() => { if (hash) document.getElementById(hash.slice(1))?.scrollIntoView(); }, [hash]);

  return (
    <>
      <Container>
        <PageHeader eyebrow="How it works" title="From “where is AI used?” to “AI only leaves through Aegis”." />
        <div className="pb-16"><PhaseCards compact /></div>
      </Container>

      <Section id="journey" tone="canvas" eyebrow="A typical rollout" title="Week by week.">
        <Steps items={JOURNEY} />
      </Section>

      <Section id="enforce" eyebrow="Phase 3 · Enforce and prove" title="Route, lock, verify.">
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {LOCKS.map((x) => (
            <Panel key={x.title} className={clsx('p-5 flex flex-col gap-3', x.status === 'Coming' && 'border-dashed')}>
              <div className="flex items-start justify-between gap-3">
                <span className={clsx('w-11 h-11 rounded-xl flex items-center justify-center', x.status === 'Coming' ? 'bg-canvas text-ink-muted' : 'bg-ink text-white')}><Icon name={x.icon} className="w-6 h-6" /></span>
                <Status value={x.status} />
              </div>
              <span className="font-bold text-lg">{x.title}</span>
              <span className="text-sm text-ink-muted">{x.sub}</span>
            </Panel>
          ))}
        </div>
        <Panel className="mt-8 p-6 sm:p-8">
          <p className="m-0 text-sm text-ink-muted">Share of AI traffic through Aegis · example</p>
          <div className="mt-4 flex flex-col gap-3" aria-label="Example: 12% of AI traffic went through Aegis at the assessment, 64% after routing apps, 97% after locking direct paths.">
            {[['Assessment', 12], ['Apps routed', 64], ['Paths locked', 97]].map(([label, v]) => (
              <div key={label as string} className="grid items-center gap-3" style={{ gridTemplateColumns: 'minmax(110px, 160px) minmax(0, 1fr) 48px' }}>
                <span className="text-sm">{label}</span>
                <div className="h-3 bg-line-subtle rounded-full"><div className={clsx('h-3 rounded-full', (v as number) > 90 ? 'bg-ink' : 'bg-ink-faint')} style={{ width: `${v}%` }} /></div>
                <span className="font-mono text-sm text-right">{v}%</span>
              </div>
            ))}
          </div>
        </Panel>
      </Section>

      <ClosingCta />
    </>
  );
}
