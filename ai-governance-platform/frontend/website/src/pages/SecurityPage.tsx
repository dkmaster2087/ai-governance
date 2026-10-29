import { Container, CtaLink, PageHeader } from '../components/ui';

const ITEMS = [
  { title: 'Fails closed', body: 'If the policy or personal-data check can’t run, the request is blocked. Companies can choose to let requests through instead; each one is then flagged in the evidence log.' },
  { title: 'Tenants are isolated by identity', body: 'Which company a request belongs to comes from its verified API key or sign-in, never from a header the caller sets. Every endpoint checks role and permission.' },
  { title: 'Provider keys stay in Secrets Manager', body: 'API keys you add for OpenAI or other providers are stored in AWS Secrets Manager. The gateway’s database only keeps a reference and the last four characters.' },
  { title: 'We don’t keep what was sent', body: 'For delivered requests, only a SHA-256 fingerprint of the prompt is kept. For stopped requests, a short excerpt around the trigger is kept as evidence, with personal data masked.' },
  { title: 'Sign-in', body: 'The dashboard signs in through Amazon Cognito, with authenticator-app MFA. Users can’t change their own role or company. Single sign-on with Okta and Microsoft Entra is planned.' },
  { title: 'Encrypted at rest', body: 'Audit records and configuration are encrypted with KMS keys; in your own AWS account, they’re your keys.' },
  { title: 'Least-privilege API keys', body: 'Keys carry scopes: one for sending chat requests, one for the browser extension to report visits, and on-premises license keys issued only by us.' },
  { title: 'Tamper-resistant extension', body: 'Settings pushed through Chrome policy can’t be changed by employees, so monitoring can’t be quietly switched off.' },
];

export function SecurityPage() {
  return (
    <Container>
      <PageHeader eyebrow="Security" title="A security product should be boring to attack.">
        How Aegis protects the prompts that pass through it and the people who use it.
      </PageHeader>
      <div className="grid gap-x-12 gap-y-10 pb-16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {ITEMS.map((i) => (
          <section key={i.title} className="border-t-2 border-ink pt-4">
            <h2 className="m-0 text-xl font-bold">{i.title}</h2>
            <p className="m-0 mt-2 text-ink-muted leading-relaxed">{i.body}</p>
          </section>
        ))}
      </div>
      <section className="py-14 border-t border-line flex flex-wrap gap-4 items-center justify-between">
        <div>
          <h2 className="m-0 text-[28px] font-bold tracking-[-0.02em]">Found a security issue?</h2>
          <p className="m-0 mt-2 text-ink-muted">Tell us privately and we’ll respond within two business days.</p>
        </div>
        <CtaLink to="/contact" variant="secondary">Report it</CtaLink>
      </section>
    </Container>
  );
}
