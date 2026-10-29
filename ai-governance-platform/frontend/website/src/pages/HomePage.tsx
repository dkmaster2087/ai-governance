import { Link } from 'react-router-dom';
import { Container, CtaLink, Eyebrow, Panel, PipelineIllustration } from '../components/ui';

const RESULTS = [
  {
    lead: 'Confidential work',
    red: 'never reaches',
    tail: 'a model.',
    body: 'Policy rules stop prompts that mention your confidential terms, match your patterns, contain health data, or use a model you haven’t approved. Nothing is sent.',
    link: { to: '/docs/rules', label: 'How rules work' },
  },
  {
    lead: 'Personal data leaves as',
    red: '',
    tail: 'placeholders.',
    body: 'Emails, phone numbers, Social Security and card numbers are removed in place before a prompt leaves the company. The app keeps working.',
    link: { to: '/docs/personal-data', label: 'What gets cleaned' },
  },
  {
    lead: 'AI use that goes',
    red: 'around you',
    tail: 'becomes visible.',
    body: 'A managed browser extension shows who uses ChatGPT, Claude and other tools outside the gateway. Decide tool by tool: block, allow or keep watching.',
    link: { to: '/docs/browser-extension', label: 'Shadow AI' },
  },
  {
    lead: 'Every decision comes with',
    red: '',
    tail: 'evidence.',
    body: 'Each request has a case file: what happened at each check, what triggered a stop (with personal data masked), fingerprints and retention. Download it for an auditor.',
    link: { to: '/docs/evidence', label: 'Evidence' },
  },
];

const WAYS_IN = [
  { title: 'Your apps', body: 'Point any OpenAI-compatible client at the gateway and use an Aegis API key. One line of configuration.', to: '/docs/quick-start' },
  { title: 'Developers’ IDEs', body: 'Your corporate proxy sends Cursor, Copilot and other IDE traffic through Aegis. Developers keep their own provider keys.', to: '/docs/proxy-mode' },
  { title: 'Employees’ browsers', body: 'Roll the extension out through Chrome policy. Settings are locked, so it can’t be switched off.', to: '/docs/browser-extension' },
];

export function HomePage() {
  return (
    <>
      <section className="bg-canvas border-b border-line">
        <Container className="pt-16 sm:pt-24 pb-14">
          <Eyebrow className="mb-4">The AI gateway for security teams</Eyebrow>
          <h1 className="m-0 text-[42px] sm:text-[60px] leading-[1.04] font-bold tracking-[-0.035em] max-w-[1000px]">
            Every AI request your company makes goes through one gateway. The risky ones <span className="text-stop">stop there</span>.
          </h1>
          <p className="m-0 mt-6 text-lg sm:text-xl text-ink-muted max-w-[720px] leading-relaxed">
            Aegis checks each prompt before it leaves: it stops confidential material, removes personal data, shows you AI use that goes
            around it, and keeps evidence for every decision.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <CtaLink to="/contact">Book a demo</CtaLink>
            <CtaLink to="/docs" variant="secondary">Read the docs</CtaLink>
          </div>
          <Panel className="mt-14 px-6 sm:px-8 pt-7 pb-5">
            <PipelineIllustration />
          </Panel>
        </Container>
      </section>

      <section aria-labelledby="results">
        <Container className="py-20">
          <Eyebrow className="mb-3"><span id="results">What changes</span></Eyebrow>
          <div className="grid gap-x-14 gap-y-14 mt-8" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            {RESULTS.map((r) => (
              <div key={r.tail} className="border-t-2 border-ink pt-5 flex flex-col gap-3">
                <h2 className="m-0 text-[30px] leading-[1.12] font-bold tracking-[-0.02em]">
                  {r.lead} {r.red && <span className="text-stop">{r.red}</span>} {r.tail}
                </h2>
                <p className="m-0 text-ink-muted text-[16px] leading-relaxed">{r.body}</p>
                <Link to={r.link.to} className="font-semibold text-ink hover:text-stop no-underline">{r.link.label} →</Link>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section aria-labelledby="ways-in" className="bg-canvas border-y border-line">
        <Container className="py-20">
          <Eyebrow className="mb-3"><span id="ways-in">Fits how you already work</span></Eyebrow>
          <h2 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em] max-w-[760px]">Three ways traffic reaches Aegis. None of them needs your people to change how they work.</h2>
          <div className="grid gap-5 mt-10" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {WAYS_IN.map((w) => (
              <Panel key={w.title} className="p-6 flex flex-col gap-3">
                <h3 className="m-0 text-xl font-bold">{w.title}</h3>
                <p className="m-0 text-ink-muted leading-relaxed">{w.body}</p>
                <Link to={w.to} className="mt-auto font-semibold text-ink hover:text-stop no-underline">Set it up →</Link>
              </Panel>
            ))}
          </div>
        </Container>
      </section>

      <section aria-labelledby="where">
        <Container className="py-20 grid gap-12" >
          <div className="grid gap-12" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <div>
              <Eyebrow className="mb-3"><span id="where">Where it runs</span></Eyebrow>
              <h2 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">In your own AWS account, so prompts stay inside your network.</h2>
              <p className="m-0 mt-4 text-ink-muted text-[16px] leading-relaxed">Or use the hosted service. Either way, provider keys live in AWS Secrets Manager and every audit record is encrypted.</p>
              <Link to="/deployment" className="inline-block mt-4 font-semibold text-ink hover:text-stop no-underline">Deployment options →</Link>
            </div>
            <div>
              <Eyebrow className="mb-3">When something breaks</Eyebrow>
              <h2 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">If a check can’t run, the request is blocked, not waved through.</h2>
              <p className="m-0 mt-4 text-ink-muted text-[16px] leading-relaxed">You can choose to let requests through instead; when you do, each one is flagged in the evidence log.</p>
              <Link to="/security" className="inline-block mt-4 font-semibold text-ink hover:text-stop no-underline">How Aegis is secured →</Link>
            </div>
          </div>
        </Container>
      </section>

      <section className="bg-ink text-white">
        <Container className="py-16 flex flex-wrap items-center justify-between gap-6">
          <h2 className="m-0 text-[32px] leading-[1.15] font-bold tracking-[-0.02em] max-w-[680px]">See what your company’s AI traffic looks like in a week.</h2>
          <Link to="/contact" className="min-h-[48px] flex items-center px-6 rounded-lg bg-white text-ink font-semibold no-underline hover:bg-ink-tint">Book a demo</Link>
        </Container>
      </section>
    </>
  );
}
