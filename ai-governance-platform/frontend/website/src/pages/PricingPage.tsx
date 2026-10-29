import { Container, CtaLink, PageHeader, Panel } from '../components/ui';

const PLANS = [
  {
    name: 'Starter', price: '$499', period: '/month', description: 'For a first team putting AI behind a gateway.',
    features: ['Up to 100,000 requests a month', 'Policy rules and personal-data cleaning', 'Evidence kept for 30 days', 'Email support'],
  },
  {
    name: 'Professional', price: '$1,499', period: '/month', description: 'For security teams governing AI across the company.',
    features: ['Up to 1 million requests a month', 'Shadow AI with the browser extension', 'IDE traffic through your corporate proxy', 'SOC 2, HIPAA and EU AI Act controls', 'Evidence kept for 1 year', 'Priority support'],
    featured: true,
  },
  {
    name: 'Enterprise', price: 'Custom', period: '', description: 'For large or regulated organizations.',
    features: ['Unlimited requests', 'Deploy in your own AWS account', 'Custom evidence retention', 'Dedicated support contact'],
  },
];

export function PricingPage() {
  return (
    <Container>
      <PageHeader eyebrow="Pricing" title="Priced by how much AI traffic you govern.">
        Every plan includes the gateway, the dashboard and the evidence log. Talk to us to start.
      </PageHeader>
      <div className="grid gap-5 pb-16 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {PLANS.map((p) => (
          <Panel key={p.name} className={p.featured ? 'p-6 border-2 border-ink flex flex-col gap-4' : 'p-6 flex flex-col gap-4'}>
            <div>
              <h2 className="m-0 text-xl font-bold">{p.name}</h2>
              <p className="m-0 mt-1 text-ink-muted">{p.description}</p>
            </div>
            <p className="m-0"><span className="text-[40px] font-extrabold tracking-[-0.03em]">{p.price}</span><span className="text-ink-muted">{p.period}</span></p>
            <ul className="m-0 pl-5 flex flex-col gap-1.5">{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
            <CtaLink to="/contact" variant={p.featured ? 'primary' : 'secondary'} className="mt-2">{p.price === 'Custom' ? 'Contact sales' : 'Talk to us'}</CtaLink>
          </Panel>
        ))}
      </div>
    </Container>
  );
}
