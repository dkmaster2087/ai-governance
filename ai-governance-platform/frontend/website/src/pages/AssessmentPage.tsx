import { ClosingCta, Container, PageHeader, Panel, Section } from '../components/ui';
import { SampleReport } from '../components/story';
import { CollectorFlow } from '../components/flows';
import { IconFacts, SourceGallery, Steps } from '../components/visuals';

export function AssessmentPage() {
  return (
    <>
      <Container>
        <PageHeader eyebrow="Phase 1 · Inspect" title="See every AI service your company uses. Your data never leaves.">
          Read-only collectors, inside your environment, reading the logs you already have.
        </PageHeader>
        <Panel className="p-4 sm:p-6 mb-16"><CollectorFlow /></Panel>
      </Container>

      <Section id="sources" tone="canvas" eyebrow="Where we look" title="The logs you already have.">
        <SourceGallery />
      </Section>

      <Section id="report" eyebrow="What you get" title="A report in two to four weeks.">
        <div className="max-w-[760px]"><SampleReport /></div>
      </Section>

      <Section id="privacy" tone="canvas" eyebrow="Privacy" title="Built to pass your security review.">
        <IconFacts items={[
          ['eye', 'Read-only', 'Nothing in your traffic path'],
          ['trash', 'AI matches only', 'Every other line dropped'],
          ['identity', 'People are codes', 'The key stays with you'],
          ['lock', 'No content, ever', 'Encrypted traffic isn’t read'],
          ['plug', 'Removed in one step', 'Delete the template or container'],
          ['offline', 'Works offline', 'No internet access needed'],
        ]} />
      </Section>

      <Section id="effort" eyebrow="Your team’s time" title="About a day, over a month.">
        <Steps items={[
          { when: '30 minutes', title: 'Scoping call' },
          { when: 'Under 1 hour per source', title: 'Install collectors' },
          { when: '2–4 weeks', title: 'Collect' },
          { when: '1 hour', title: 'Walk through the report' },
        ]} />
      </Section>

      <ClosingCta />
    </>
  );
}
