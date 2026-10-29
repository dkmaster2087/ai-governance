import { Container, CtaLink, PageHeader } from '../components/ui';

export function AboutPage() {
  return (
    <Container>
      <PageHeader eyebrow="About" title="We build the control point for AI at work.">
        People will use AI with or without permission. Aegis gives security teams one place where every AI request is checked, every
        decision is recorded, and the rules are written in plain language.
      </PageHeader>
      <div className="pb-16 max-w-[760px] flex flex-col gap-4 text-[17px] leading-relaxed">
        <p className="m-0">We focus on results rather than reports: what was stopped, what was cleaned, who went around the gateway, and the evidence to prove it.</p>
        <p className="m-0">If that’s the problem you’re working on, we’d like to hear from you.</p>
        <CtaLink to="/contact" className="self-start mt-2">Get in touch</CtaLink>
      </div>
    </Container>
  );
}
