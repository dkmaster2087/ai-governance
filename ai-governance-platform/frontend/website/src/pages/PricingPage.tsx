import { Container, CtaLink, PageHeader, Panel, Status } from '../components/ui';

const INCLUDED = [
  'Unlimited requests and people',
  'Every check: rules, secrets, personal data, prompt attacks',
  'Apps, IDEs, browsers and AI agents (MCP)',
  'SOC 2, HIPAA and EU AI Act controls',
  'Evidence kept as long as you choose',
  'Log export to your SIEM',
  'Cloud or on-premises, same price',
  'Email support and every update',
];

export function PricingPage() {
  return (
    <Container>
      <PageHeader eyebrow="Pricing" title="One price. Everything included.">
        No tiers and no usage limits. Start with the assessment.
      </PageHeader>
      <Panel className="p-6 sm:p-8 mb-8 border-2 border-ink grid gap-6 items-center" >
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-[720px]">
            <Status value="Available" />
            <h2 className="m-0 mt-3 text-2xl font-bold">AI usage assessment</h2>
            <p className="m-0 mt-2 text-ink-muted leading-relaxed">Two to four weeks of read-only collection in your AWS accounts and data centre, a report built inside your environment, and a walkthrough with recommendations. Fixed scope, agreed up front.</p>
          </div>
          <CtaLink to="/contact">Book an assessment</CtaLink>
        </div>
      </Panel>
      <div className="pb-16">
        <Panel className="p-6 sm:p-8 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-start">
          <div className="flex flex-col gap-3">
            <h2 className="m-0 text-xl font-bold">Probaline</h2>
            <p className="m-0 text-ink-muted">The gateway, the dashboard and the evidence log, for your whole company.</p>
            <p className="m-0"><span className="text-[40px] font-extrabold tracking-[-0.03em]">$2,000</span><span className="text-ink-muted">/month</span></p>
            <p className="m-0 text-sm text-ink-muted">One license: one gateway address, run as many copies as you need behind your load balancer.</p>
            <CtaLink to="/contact" className="mt-2 self-start">Talk to us</CtaLink>
          </div>
          <ul className="m-0 pl-5 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">{INCLUDED.map((f) => <li key={f}>{f}</li>)}</ul>
        </Panel>
      </div>
    </Container>
  );
}
