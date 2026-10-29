import { Container, CtaLink, Eyebrow, PageHeader, Panel } from '../components/ui';

const OPTIONS = [
  {
    name: 'Hosted by us',
    status: 'Available',
    body: 'We run the gateway on AWS for you. Point your apps at your gateway address and you’re done.',
    points: ['Separate tenant per company, isolated by verified identity', 'Sign-in with MFA for your team', 'Updates applied for you'],
  },
  {
    name: 'In your AWS account',
    status: 'Available',
    body: 'Deploy the same gateway into your own AWS account with the provided infrastructure code. Prompts never leave your network.',
    points: ['Runs in your VPC on ECS Fargate', 'Your KMS keys, your Secrets Manager, your audit buckets', 'Optional reporting to us, with a license key, of usage numbers only'],
  },
  {
    name: 'On-premises and Kubernetes',
    status: 'Planned',
    body: 'A Helm chart and support for data centres without AWS, including air-gapped networks.',
    points: ['Pluggable database and object storage', 'Offline license checks'],
  },
];

export function DeploymentPage() {
  return (
    <Container>
      <PageHeader eyebrow="Deployment" title="Run it where your data is allowed to be.">
        The hosted service and the deploy-in-your-account option are the same software. Choose based on where prompts are allowed to travel.
      </PageHeader>
      <div className="grid gap-5 pb-16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {OPTIONS.map((o) => (
          <Panel key={o.name} className="p-6 flex flex-col gap-3">
            <span className={o.status === 'Planned' ? 'self-start text-xs font-semibold px-2 py-0.5 rounded-full border border-dashed border-line-strong text-ink-muted' : 'self-start text-xs font-semibold px-2 py-0.5 rounded-full bg-ink-tint text-ink'}>{o.status}</span>
            <h2 className="m-0 text-2xl font-bold">{o.name}</h2>
            <p className="m-0 text-ink-muted leading-relaxed">{o.body}</p>
            <ul className="m-0 pl-5 flex flex-col gap-1.5">{o.points.map((p) => <li key={p}>{p}</li>)}</ul>
          </Panel>
        ))}
      </div>
      <section className="py-14 border-t border-line grid gap-10" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div>
          <Eyebrow className="mb-3">What you need</Eyebrow>
          <h2 className="m-0 text-[28px] font-bold tracking-[-0.02em]">To deploy in your own account</h2>
        </div>
        <ul className="m-0 pl-5 flex flex-col gap-2 text-[16px]">
          <li>An AWS account and permission to deploy with AWS CDK</li>
          <li>Access to Amazon Bedrock, or API keys for the providers you use</li>
          <li>A domain name and a TLS certificate for the gateway</li>
          <li>Chrome policy management (Google Admin, Intune or Jamf) if you want the browser extension</li>
        </ul>
      </section>
      <section className="py-14 border-t border-line flex flex-wrap gap-4 items-center justify-between">
        <h2 className="m-0 text-[28px] font-bold tracking-[-0.02em]">Not sure which fits?</h2>
        <CtaLink to="/contact">Talk to us</CtaLink>
      </section>
    </Container>
  );
}
