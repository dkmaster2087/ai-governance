import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Container, CtaLink, Eyebrow, PageHeader, Panel, PipelineIllustration } from '../components/ui';

function Feature({ eyebrow, title, children, sample, docs }: { eyebrow: string; title: ReactNode; children: ReactNode; sample: ReactNode; docs: string }) {
  return (
    <section className="py-16 border-t border-line grid gap-10 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
      <div>
        <Eyebrow className="mb-3">{eyebrow}</Eyebrow>
        <h2 className="m-0 text-[32px] leading-[1.12] font-bold tracking-[-0.02em]">{title}</h2>
        <div className="mt-4 text-ink-muted text-[16px] leading-relaxed flex flex-col gap-3">{children}</div>
        <Link to={docs} className="inline-block mt-4 font-semibold text-ink hover:text-stop no-underline">Read the docs →</Link>
      </div>
      <div>
        {sample}
        <p className="m-0 mt-2 text-xs text-ink-muted">Sample from the dashboard.</p>
      </div>
    </section>
  );
}

export function ProductPage() {
  return (
    <Container>
      <PageHeader eyebrow="Product" title="One gateway, three checks, and a record of every decision.">
        Aegis sits between your company and AI providers. Every request passes the same checks in the same order, and the dashboard
        shows what they did rather than another wall of charts.
      </PageHeader>

      <Panel className="px-6 sm:px-8 pt-7 pb-5 mb-6"><PipelineIllustration /></Panel>

      <Feature
        eyebrow="Gateway"
        title="The home screen is your traffic, drawn as it flows."
        docs="/docs"
        sample={
          <Panel className="p-6">
            <p className="m-0 text-[22px] leading-snug font-bold tracking-[-0.015em]">In the last 7 days, Aegis stopped <span className="text-stop">17</span> risky AI requests and cleaned 31 more before they left Demo Corp.</p>
          </Panel>
        }
      >
        <p className="m-0">Apps on the left, each check in order, providers on the right. What a check stops drops out beneath it in red.</p>
        <p className="m-0">Below it: the decisions waiting for you, and a plain-English feed of what just happened.</p>
      </Feature>

      <Feature
        eyebrow="Stopped"
        title={<>Everything that was <span className="text-stop">stopped</span>, grouped by why.</>}
        docs="/docs/rules"
        sample={
          <Panel className="p-6 flex flex-col gap-3">
            <div className="flex items-baseline gap-4"><span className="text-[40px] font-extrabold text-stop leading-none">25</span><span className="text-lg font-bold">Block confidential keywords</span></div>
            <p className="m-0 text-ink-muted">billing-api (20) · support-bot (5) · 4 people</p>
            <div className="bg-canvas border border-line-subtle rounded-[10px] px-4 py-3 font-mono text-[13px]">Summarise the attached <mark className="bg-stop-soft text-stop-text font-bold px-1 rounded">confidential</mark> pricing memo…</div>
          </Panel>
        }
      >
        <p className="m-0">Each rule that fired gets one card: how often, which apps and people, and a short excerpt of exactly what triggered it.</p>
        <p className="m-0">Personal data in the excerpt is masked. If the trigger itself is personal data, only its type is kept, such as [SSN].</p>
      </Feature>

      <Feature
        eyebrow="Shadow AI"
        title={<>See who goes <span className="text-stop">around</span> the gateway, then decide.</>}
        docs="/docs/browser-extension"
        sample={
          <Panel className="p-6 flex flex-wrap items-center gap-6 justify-between">
            <div><div className="text-xl font-bold">ChatGPT <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-line-subtle text-ink-soft align-middle">Undecided</span></div><div className="font-mono text-xs text-ink-muted">chatgpt.com, chat.openai.com</div></div>
            <div className="flex gap-6"><div><div className="text-2xl font-extrabold">18</div><div className="text-xs text-ink-muted">visits</div></div><div><div className="text-2xl font-extrabold">6</div><div className="text-xs text-ink-muted">people</div></div></div>
            <div className="flex gap-2"><span className="px-3.5 py-2 rounded-lg bg-ink text-white font-semibold text-sm">Block</span><span className="px-3.5 py-2 rounded-lg border border-line-strong text-sm">Allow</span></div>
          </Panel>
        }
      >
        <p className="m-0">The browser extension records visits to AI tools outside the gateway. You decide per tool: block it, allow it, or keep watching.</p>
        <p className="m-0">People who hit a blocked tool see a plain page explaining it isn’t approved and pointing them to tools that are.</p>
      </Feature>

      <Feature
        eyebrow="Rules"
        title="Rules read like sentences, and show what they caught."
        docs="/docs/rules"
        sample={
          <Panel className="p-6 flex flex-col gap-3">
            <p className="m-0 font-semibold">Stop prompts that mention <span className="font-mono text-[13px] bg-ink-tint rounded px-1.5">confidential, top secret</span>.</p>
            <p className="m-0 font-bold text-stop">25 stopped this week</p>
          </Panel>
        }
      >
        <p className="m-0">Words and phrases, patterns, approved models and personal-data types. Switch any rule on or off; framework rules can be paused but not deleted.</p>
        <p className="m-0">Controls from compliance frameworks that the gateway doesn’t enforce are listed separately, so nothing looks more protective than it is.</p>
      </Feature>

      <Feature
        eyebrow="Evidence"
        title="Every request has a case file you can hand to an auditor."
        docs="/docs/evidence"
        sample={
          <Panel className="p-6 flex flex-col gap-2">
            <p className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-stop">Stopped · check 1, policy rules</p>
            <p className="m-0 text-xl font-bold leading-snug">A billing-api prompt was stopped and never reached OpenAI.</p>
            <ol className="m-0 pl-5 text-ink-muted"><li>Received from billing-api</li><li><span className="text-stop font-semibold">Stopped by a policy rule</span></li><li>Not sent</li></ol>
          </Panel>
        }
      >
        <p className="m-0">Search by person, app, rule or request ID. Each record shows what happened at every check, the masked trigger, prompt fingerprints and how long it’s kept.</p>
        <p className="m-0">Download any record as a file. The gateway never stores the text of prompts that were delivered.</p>
      </Feature>

      <section className="py-16 border-t border-line flex flex-wrap gap-4 items-center justify-between">
        <h2 className="m-0 text-[28px] font-bold tracking-[-0.02em]">Want to see it on your own traffic?</h2>
        <CtaLink to="/contact">Book a demo</CtaLink>
      </section>
    </Container>
  );
}
