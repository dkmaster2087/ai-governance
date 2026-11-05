import { Link } from 'react-router-dom';
import { ClosingCta, Container, CtaLink, Eyebrow, Panel, Section } from '../components/ui';
import { PhaseCards } from '../components/story';
import { CollectorFlow, GatewayFlow } from '../components/flows';
import { DeploymentPicture, IconFacts, SourceGallery } from '../components/visuals';
import { MODELS } from './DeploymentPage';

export function HomePage() {
  return (
    <>
      <section className="bg-canvas border-b border-line">
        <Container className="pt-16 sm:pt-24 pb-16">
          <Eyebrow className="mb-4">AI security for the whole company</Eyebrow>
          <h1 className="m-0 text-[42px] sm:text-[62px] leading-[1.03] font-bold tracking-[-0.035em] max-w-[960px]">
            Find every AI request your company makes. Then control it.
          </h1>
          <p className="m-0 mt-6 text-lg sm:text-xl text-ink-muted max-w-[640px] leading-relaxed">
            Inspect the logs you already have. Route AI through one gateway. Close every other path.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <CtaLink to="/contact">Book an AI usage assessment</CtaLink>
            <CtaLink to="/how-it-works" variant="secondary">How it works</CtaLink>
          </div>
        </Container>
      </section>

      <Section id="phases" eyebrow="How Probaline works" title="Inspect. Protect. Enforce.">
        <PhaseCards compact />
      </Section>

      <Section id="inspect" tone="canvas" eyebrow="Phase 1 · Inspect" title="Find AI use in the logs you already have.">
        <Panel className="p-4 sm:p-6"><CollectorFlow /></Panel>
        <div className="mt-10"><SourceGallery limit={10} /></div>
        <Link to="/assessment" className="inline-block mt-6 font-semibold text-ink hover:text-stop no-underline">All sources and the report →</Link>
      </Section>

      <Section id="protect" eyebrow="Phase 2 · Protect" title="Every request checked before it leaves.">
        <Panel className="p-4 sm:p-6"><GatewayFlow /></Panel>
        <div className="mt-12">
          <IconFacts items={[
            ['lock', 'Confidential work stopped', 'Your words, patterns, approved models'],
            ['key', 'Secrets never leave', 'API keys, tokens, private keys, passwords'],
            ['plug', 'Agents reach your APIs safely', 'MCP servers, every call checked'],
            ['identity', 'Personal data removed', 'In prompts and in answers'],
            ['browser', 'Shadow AI visible', 'Block, approve or keep watching'],
            ['report', 'Evidence for every decision', 'A case file per request'],
          ]} />
        </div>
        <Link to="/gateway" className="inline-block mt-8 font-semibold text-ink hover:text-stop no-underline">What the gateway does →</Link>
      </Section>

      <Section id="where" tone="canvas" eyebrow="Where it runs" title="Your environment, your choice of who operates it.">
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {MODELS.map((m) => (
            <Panel key={m.name} className="p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3"><span className="text-xl font-bold">{m.name}</span><span className="text-xs text-ink-muted">{m.status}</span></div>
              <DeploymentPicture ours={m.ours} theirs={m.theirs} />
            </Panel>
          ))}
        </div>
        <Link to="/deployment" className="inline-block mt-6 font-semibold text-ink hover:text-stop no-underline">Deployment options →</Link>
      </Section>

      <ClosingCta />
    </>
  );
}
