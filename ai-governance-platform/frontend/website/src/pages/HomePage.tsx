import { Link } from 'react-router-dom';
import { ClosingCta, Container, CtaLink, Eyebrow, Panel, Section, Status } from '../components/ui';
import { PhaseCards } from '../components/story';
import { CollectorFlow, GatewayFlow } from '../components/flows';
import { DeploymentPicture, IconFacts, SourceGallery } from '../components/visuals';
import { MODELS } from './DeploymentPage';

/** Gateways that can call Probaline's checks as a guardrail. */
const GATEWAYS: Array<{ name: string; status: 'Available' | 'Beta'; how: string }> = [
  { name: 'LiteLLM', status: 'Beta', how: 'A guardrail before and after the model. Cleaned prompts and answers go back to LiteLLM.' },
  { name: 'Portkey', status: 'Beta', how: 'A webhook guardrail on input and output. Cleaned prompts and answers go back to Portkey.' },
  { name: 'Kong AI Gateway', status: 'Beta', how: 'The AI Custom Guardrail plugin. Kong can only allow or stop, so anything to remove stops the call.' },
  { name: 'Probaline’s gateway', status: 'Available', how: 'No gateway yet? Point apps, IDEs and agents at Probaline’s own.' },
];

export function HomePage() {
  return (
    <>
      <section className="bg-canvas border-b border-line">
        <Container className="pt-16 sm:pt-24 pb-16">
          <Eyebrow className="mb-4">AI compliance and audit</Eyebrow>
          <h1 className="m-0 text-[42px] sm:text-[62px] leading-[1.03] font-bold tracking-[-0.035em] max-w-[960px]">
            Prove how your company uses AI.
          </h1>
          <p className="m-0 mt-6 text-lg sm:text-xl text-ink-muted max-w-[680px] leading-relaxed">
            Find every AI request your company makes, enforce your rules on each one, and keep the evidence your auditors ask for. With your AI gateway or ours.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <CtaLink to="/contact">Book an AI usage assessment</CtaLink>
            <CtaLink to="/how-it-works" variant="secondary">How it works</CtaLink>
          </div>
        </Container>
      </section>

      <Section id="evidence" eyebrow="Audit-ready" title="Every AI decision, on the record." intro="When an auditor, a regulator or your board asks how AI is used and controlled, the answer is already written down.">
        <IconFacts items={[
          ['report', 'A case file for every request', 'Who, which app and model, every check’s result. Prompts are fingerprinted, never stored'],
          ['lock', 'SOC 2, HIPAA and EU AI Act controls', 'Each control shown as enforced, built in, needing your action, or not covered'],
          ['eye', 'Every admin change recorded', 'Rules, keys, models and sign-ins: who, what, when and from where'],
          ['server', 'Into your own tools', 'Splunk, Datadog, Elastic or any OpenTelemetry collector'],
          ['identity', 'An auditor role', 'Read evidence and activity without changing anything'],
          ['clock', 'Kept as long as you need', 'Retention you set, with a legal hold'],
        ]} />
        <Link to="/compliance" className="inline-block mt-8 font-semibold text-ink hover:text-stop no-underline">Compliance and audit →</Link>
      </Section>

      <Section id="phases" tone="canvas" eyebrow="How Probaline works" title="Inspect. Protect. Enforce and prove.">
        <PhaseCards compact />
      </Section>

      <Section id="inspect" eyebrow="Phase 1 · Inspect" title="Find AI use in the logs you already have.">
        <Panel className="p-4 sm:p-6"><CollectorFlow /></Panel>
        <div className="mt-10"><SourceGallery limit={10} /></div>
        <Link to="/assessment" className="inline-block mt-6 font-semibold text-ink hover:text-stop no-underline">All sources and the report →</Link>
      </Section>

      <Section id="protect" tone="canvas" eyebrow="Phase 2 · Protect" title="Every request checked before it leaves.">
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

      <Section id="your-gateway" eyebrow="Works with your AI gateway" title="Keep the gateway you have. Add the controls and the evidence." intro="Already route AI through LiteLLM, Portkey or Kong? Keep it for routing, keys and budgets. It calls Probaline’s checks before and after the model, and Probaline keeps the case file.">
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
          {GATEWAYS.map((g) => (
            <Panel key={g.name} className="p-5 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3"><h3 className="m-0 text-lg font-bold">{g.name}</h3><Status value={g.status} /></div>
              <p className="m-0 text-[15px] text-ink-muted leading-relaxed">{g.how}</p>
            </Panel>
          ))}
        </div>
      </Section>

      <Section id="where" tone="canvas" eyebrow="Where it runs" title="Your environment, your choice of who operates it.">
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))' }}>
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
