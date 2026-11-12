import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ClosingCta, Container, Eyebrow, PageHeader, Panel, Status } from '../components/ui';
import { GatewayFlow, McpFlow } from '../components/flows';

function Feature({ eyebrow, title, children, sample }: { eyebrow: string; title: ReactNode; children: ReactNode; sample: ReactNode }) {
  return (
    <section className="py-16 border-t border-line grid gap-10 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
      <div>
        <Eyebrow className="mb-3">{eyebrow}</Eyebrow>
        <h2 className="m-0 text-[32px] leading-[1.12] font-bold tracking-[-0.02em]">{title}</h2>
        <div className="mt-4 text-ink-muted text-[16px] leading-relaxed flex flex-col gap-3">{children}</div>
      </div>
      <div>
        {sample}
        <p className="m-0 mt-2 text-xs text-ink-muted">Sample from the dashboard.</p>
      </div>
    </section>
  );
}

const WAYS_IN: Array<{ title: string; status: 'Available' | 'Beta'; points: string[] }> = [
  {
    title: 'Your apps',
    status: 'Available',
    points: ['Amazon Bedrock and OpenAI models behind one endpoint', 'Streaming answers, with personal data removed as they stream', 'Every check: rules, secrets, personal data, evidence'],
  },
  {
    title: 'Developers’ IDEs',
    status: 'Available',
    points: ['OpenAI, Anthropic, Cohere and Mistral formats', 'Rules, secrets, personal data and evidence apply to every prompt', 'Answers stream straight through from the provider'],
  },
  {
    title: 'Employees’ browsers',
    status: 'Beta',
    points: ['Pushed by your IT team; settings locked', 'Records the tool’s domain only, never what people type', 'Watch-only until you decide'],
  },
  {
    title: 'AI agents (MCP)',
    status: 'Available',
    points: ['People sign in with their company account', 'Changes wait for a person’s approval', 'Every call checked and kept as evidence'],
  },
];

export function GatewayPage() {
  return (
    <>
    <Container>
      <PageHeader eyebrow="Phase 2 · Protect" title="One gateway, three checks, and a record of every decision.">
        Between your company and every AI provider.
      </PageHeader>

      <Panel className="p-4 sm:p-6 mb-6"><GatewayFlow /></Panel>

      <section aria-labelledby="ways-in" className="py-16 border-t border-line">
        <Eyebrow className="mb-3">Ways in</Eyebrow>
        <h2 id="ways-in" className="m-0 text-[32px] leading-[1.12] font-bold tracking-[-0.02em] max-w-[760px]">Four ways in. Nobody works differently.</h2>
        <div className="grid gap-5 mt-10" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))' }}>
          {WAYS_IN.map((w) => (
            <Panel key={w.title} className="p-6 flex flex-col gap-3">
              <Status value={w.status} />
              <h3 className="m-0 text-xl font-bold">{w.title}</h3>
              <ul className="m-0 pl-5 flex flex-col gap-1 text-[15px]">{w.points.map((p) => <li key={p}>{p}</li>)}</ul>
            </Panel>
          ))}
        </div>
      </section>

      <Feature
        eyebrow="Gateway"
        title="The home screen is your traffic, drawn as it flows."
        sample={
          <Panel className="p-6">
            <p className="m-0 text-[22px] leading-snug font-bold tracking-[-0.015em]">In the last 7 days, Probaline stopped <span className="text-stop">17</span> risky AI requests and cleaned 31 more before they left Demo Corp.</p>
          </Panel>
        }
      >
        <p className="m-0">Apps on the left, each check in order, providers on the right. What a check stops drops out beneath it in red.</p>
      </Feature>

      <Feature
        eyebrow="Stopped"
        title={<>Everything that was <span className="text-stop">stopped</span>, grouped by why.</>}
        sample={
          <Panel className="p-6 flex flex-col gap-3">
            <div className="flex items-baseline gap-4"><span className="text-[40px] font-extrabold text-stop leading-none">25</span><span className="text-lg font-bold">Block confidential keywords</span></div>
            <p className="m-0 text-ink-muted">billing-api (20) · support-bot (5) · 4 people</p>
            <div className="bg-canvas border border-line-subtle rounded-[10px] px-4 py-3 font-mono text-[13px]">Summarise the attached <mark className="bg-stop-soft text-stop-text font-bold px-1 rounded">confidential</mark> pricing memo…</div>
          </Panel>
        }
      >
        <p className="m-0">Each rule that fired gets one card: how often, which apps and people, and a short excerpt of exactly what triggered it.</p>
      </Feature>

      <section aria-labelledby="coming-in" className="py-16 border-t border-line">
        <div className="flex items-center gap-3 mb-3"><Eyebrow>Coming in</Eyebrow><Status value="Available" /></div>
        <h2 id="coming-in" className="m-0 text-[32px] leading-[1.12] font-bold tracking-[-0.02em] max-w-[760px]">Agents reaching into your systems pass the same checks.</h2>
        <p className="m-0 mt-4 text-ink-muted text-[16px] leading-relaxed max-w-[760px]">Claude, ChatGPT, Cursor or your own agents call your APIs through Probaline, never directly. Each call is checked for who is asking, what it sends and, for changes, a person’s approval. The answer is cleaned on its way back.</p>
        <Panel className="p-4 sm:p-6 mt-8"><McpFlow /></Panel>
      </section>

      <Feature
        eyebrow="MCP servers"
        title={<>Give agents your APIs. Keep the <span className="text-stop">keys</span>.</>}
        sample={
          <Panel className="p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2.5"><span className="text-xl font-bold">HR self-service</span><span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-ink text-white">Live</span></div>
            <div className="font-mono text-xs text-ink-muted">/mcp/acme/hr-self-service</div>
            <ul className="m-0 p-0 list-none flex flex-col gap-1.5 text-sm">
              <li className="flex justify-between gap-3"><span><span className="font-mono text-[11px] bg-ink-tint rounded px-1.5 mr-1.5">GET</span>One employee</span><span className="font-semibold">On</span></li>
              <li className="flex justify-between gap-3"><span><span className="font-mono text-[11px] bg-ink-tint rounded px-1.5 mr-1.5">GET</span>Search employees</span><span className="font-semibold">On</span></li>
              <li className="flex justify-between gap-3"><span><span className="font-mono text-[11px] bg-ink-tint rounded px-1.5 mr-1.5">POST</span>Add an employee</span><span className="font-semibold">Needs approval</span></li>
            </ul>
            <div className="bg-canvas border border-line-subtle rounded-[10px] px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-3">
              <span><span className="font-semibold">priya@acme.com</span>’s agent wants to add Sam Lee</span>
              <span className="flex gap-2"><span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-ink text-white">Approve</span><span className="text-xs font-semibold px-2.5 py-1 rounded-md border border-line-strong">Refuse</span></span>
            </div>
            <div className="bg-canvas border border-line-subtle rounded-[10px] px-4 py-3 font-mono text-[12px]">{'{"name":"Jane Doe","email":'}<mark className="bg-ink-tint text-ink font-bold px-1 rounded">[REDACTED]</mark>{'}'}</div>
          </Panel>
        }
      >
        <p className="m-0">Create an MCP server in a minute from an OpenAPI description. People connect Claude, ChatGPT or Cursor with their company sign-in and get only their groups’ tools. Changes wait for a person’s approval, APIs inside your network are reached through a connector, and every call passes your rules.</p>
      </Feature>

      <Feature
        eyebrow="Secrets"
        title={<>A pasted key is <span className="text-stop">stopped</span>, not leaked.</>}
        sample={
          <Panel className="p-6 flex flex-col gap-3">
            <div className="bg-canvas border border-line-subtle rounded-[10px] px-4 py-3 font-mono text-[13px] leading-relaxed">
              Why does <mark className="bg-stop-soft text-stop-text font-bold px-1 rounded">[AWS access key]</mark> get AccessDenied on the orders bucket?
            </div>
            <p className="m-0 font-bold text-stop">Stopped · never reached OpenAI</p>
            <p className="m-0 text-sm text-ink-muted">Or, if you prefer: the key is removed and the rest is sent.</p>
          </Panel>
        }
      >
        <p className="m-0">Cloud and SaaS keys, tokens, private keys, connection strings and passwords. The secret itself is never stored.</p>
      </Feature>

      <Feature
        eyebrow="Shadow AI"
        title={<>See who goes <span className="text-stop">around</span> the gateway, then decide.</>}
        sample={
          <Panel className="p-6 flex flex-wrap items-center gap-6 justify-between">
            <div><div className="text-xl font-bold">ChatGPT <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-line-subtle text-ink-soft align-middle">Undecided</span></div><div className="font-mono text-xs text-ink-muted">chatgpt.com, chat.openai.com</div></div>
            <div className="flex gap-6"><div><div className="text-2xl font-extrabold">18</div><div className="text-xs text-ink-muted">visits</div></div><div><div className="text-2xl font-extrabold">6</div><div className="text-xs text-ink-muted">people</div></div></div>
            <div className="flex gap-2"><span className="px-3.5 py-2 rounded-lg bg-ink text-white font-semibold text-sm">Block</span><span className="px-3.5 py-2 rounded-lg border border-line-strong text-sm">Allow</span></div>
          </Panel>
        }
      >
        <p className="m-0">The browser extension records visits to AI tools outside the gateway. You decide per tool: block it, allow it, or keep watching.</p>
      </Feature>

      <Feature
        eyebrow="Rules"
        title="Rules read like sentences, and show what they caught."
        sample={
          <Panel className="p-6 flex flex-col gap-3">
            <p className="m-0 font-semibold">Stop prompts that mention <span className="font-mono text-[13px] bg-ink-tint rounded px-1.5">confidential, top secret</span>.</p>
            <p className="m-0 font-bold text-stop">25 stopped this week</p>
          </Panel>
        }
      >
        <p className="m-0">Words and phrases, patterns, approved models and personal-data types. Switch any rule on or off; framework rules can be paused but not deleted.</p>
      </Feature>

      <Feature
        eyebrow="Evidence"
        title="Every request has a case file you can hand to an auditor."
        sample={
          <Panel className="p-6 flex flex-col gap-2">
            <p className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-stop">Stopped · check 1, policy rules</p>
            <p className="m-0 text-xl font-bold leading-snug">A billing-api prompt was stopped and never reached OpenAI.</p>
            <ol className="m-0 pl-5 text-ink-muted"><li>Received from billing-api</li><li><span className="text-stop font-semibold">Stopped by a policy rule</span></li><li>Not sent</li></ol>
          </Panel>
        }
      >
        <p className="m-0">Search by person, app, rule or request ID. Each record shows what happened at every check, the masked trigger, prompt fingerprints and how long it’s kept.</p>
      </Feature>

      <section aria-labelledby="lock" className="py-16 border-t border-line">
        <Eyebrow className="mb-3">Phase 3 · Enforce</Eyebrow>
        <h2 id="lock" className="m-0 text-[32px] leading-[1.12] font-bold tracking-[-0.02em] max-w-[760px]">Then close the paths around it.</h2>
        <div className="mt-4 flex items-center gap-3"><Status value="Coming" /><Link to="/how-it-works#enforce" className="font-semibold text-ink hover:text-stop no-underline">How enforcement works →</Link></div>
      </section>
    </Container>
    <ClosingCta />
    </>
  );
}
