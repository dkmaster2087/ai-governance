import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ClosingCta, Container, Eyebrow, PageHeader, Panel, Status } from '../components/ui';
import { IconFacts } from '../components/visuals';

function Block({ id, eyebrow, title, children, aside }: { id: string; eyebrow: string; title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="py-16 border-t border-line grid gap-10 items-start" style={{ gridTemplateColumns: aside ? 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))' : '1fr' }}>
      <div className="min-w-0">
        <Eyebrow className="mb-3">{eyebrow}</Eyebrow>
        <h2 id={id} className="m-0 text-[32px] leading-[1.12] font-bold tracking-[-0.02em] max-w-[760px]">{title}</h2>
        <div className="mt-4 text-ink-muted text-[16px] leading-relaxed flex flex-col gap-3 max-w-[760px]">{children}</div>
      </div>
      {aside && <div className="min-w-0">{aside}</div>}
    </section>
  );
}

/** How each control is met, worked out live from what the company has switched on. */
const STATES: Array<{ state: string; meaning: string; examples: string }> = [
  { state: 'Enforced by a rule', meaning: 'A rule checks every request, and it is on', examples: 'HIPAA health-data blocking, SOC 2 approved models, rate limits' },
  { state: 'Built into Probaline', meaning: 'Done for every company', examples: 'A case file for every request, sign-in and keys, HTTPS to providers' },
  { state: 'Needs your action', meaning: 'Something only your company can do', examples: 'List the models your BAA covers, keep evidence 6 years for HIPAA, human oversight' },
  { state: 'Not covered yet', meaning: 'Probaline doesn’t do it, and says so', examples: 'Clinical accuracy of answers, marking AI-generated content (EU AI Act Art. 50)' },
];

const CASE_FILE: Array<[string, ReactNode]> = [
  ['Request', <span className="font-mono">req_7f3a…c21</span>],
  ['When', '12 Nov 2026, 09:41:07'],
  ['App · person', 'support-bot · jane@acme.com'],
  ['Model', 'Claude on Amazon Bedrock'],
  ['Rules', 'Passed 6 rules'],
  ['Secrets', 'None found'],
  ['Personal data', <span className="text-ink font-semibold">1 removed before sending</span>],
  ['Prompt', <span className="font-mono">sha256 9c1e…04ab</span>],
  ['Kept until', '12 Nov 2027'],
];

export function CompliancePage() {
  return (
    <>
      <Container>
        <PageHeader eyebrow="Compliance and audit" title="The evidence for how your company uses AI.">
          Every AI request checked against your rules and kept as a case file. Every control mapped to what is actually switched on. Every admin change on record.
        </PageHeader>

        <Block
          id="case-files"
          eyebrow="Evidence"
          title="A case file for every request."
          aside={
            <>
              <Panel className="p-6">
                <dl className="m-0 grid gap-x-6 gap-y-2 text-[15px]" style={{ gridTemplateColumns: 'max-content 1fr' }}>
                  {CASE_FILE.map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-ink-muted">{k}</dt><dd className="m-0">{v}</dd></div>
                  ))}
                </dl>
              </Panel>
              <p className="m-0 mt-2 text-xs text-ink-muted">Sample from the dashboard.</p>
            </>
          }
        >
          <p className="m-0">Who asked, through which app, which model, what each check found and what happened. Searchable, and exported as a file per request.</p>
          <p className="m-0">The text of a delivered prompt is never stored, only its fingerprint, so the evidence can’t become a second copy of your data. For a stopped request, a short excerpt around what triggered it is kept, with personal data and secrets removed.</p>
        </Block>

        <Block id="controls" eyebrow="Frameworks" title="SOC 2, HIPAA and the EU AI Act, with honest status.">
          <p className="m-0">Turn a framework on and its rules are created. Each control then shows how it is met, worked out live from what is switched on, never from stored counts.</p>
          <div className="mt-4 overflow-x-auto border border-line rounded-xl bg-white">
            <table className="w-full border-collapse text-[15px] text-ink">
              <thead>
                <tr className="bg-canvas">
                  {['Status', 'Meaning', 'Examples'].map((h) => <th key={h} className="text-left font-semibold px-4 py-3 border-b border-line">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {STATES.map((s) => (
                  <tr key={s.state}>
                    <td className="px-4 py-3 border-b border-line font-semibold align-top whitespace-nowrap">{s.state}</td>
                    <td className="px-4 py-3 border-b border-line align-top">{s.meaning}</td>
                    <td className="px-4 py-3 border-b border-line align-top text-ink-muted">{s.examples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>

        <Block id="activity" eyebrow="Accountability" title="What people change is on record too.">
          <p className="m-0">Every change to rules, keys, models, MCP servers and sign-in settings, successful or refused: who, what, when, from where. Dashboard sign-ins and refused keys are kept beside them for 400 days.</p>
          <div className="mt-4">
            <IconFacts items={[
              ['identity', 'An auditor role', 'Reads evidence and activity, changes nothing'],
              ['clock', 'Retention you set', 'With a legal hold that stops all deletion'],
              ['server', 'Into your SIEM', 'Splunk, Datadog, Elastic, any OpenTelemetry collector'],
            ]} />
          </div>
        </Block>

        <Block id="coverage" eyebrow="Coverage" title="Evidence is only as good as what it covers.">
          <p className="m-0">A record of the requests you saw says nothing about the ones that went around you. Probaline also finds AI use in the logs you already have, closes the other paths, and measures the share of AI traffic that goes through a control, so the evidence covers the company, not just one app.</p>
          <div className="mt-4 grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }}>
            <Panel className="p-5 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3"><h3 className="m-0 text-lg font-bold">Find</h3><Status value="Available" /></div>
              <p className="m-0 text-[15px] leading-relaxed">AI use in cloud, firewall, proxy and DNS logs. <Link to="/assessment" className="text-ink">The assessment</Link></p>
            </Panel>
            <Panel className="p-5 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3"><h3 className="m-0 text-lg font-bold">Check</h3><Status value="Available" /></div>
              <p className="m-0 text-[15px] leading-relaxed">Apps, IDEs, browsers and agents through Probaline’s gateway, or yours. <Link to="/gateway" className="text-ink">The checks</Link></p>
            </Panel>
            <Panel className="p-5 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3"><h3 className="m-0 text-lg font-bold">Prove</h3><Status value="Beta" /></div>
              <p className="m-0 text-[15px] leading-relaxed">Cloud and firewall rules that close the other paths, and the measured share. <Link to="/how-it-works#enforce" className="text-ink">Enforcement</Link></p>
            </Panel>
          </div>
        </Block>

        <Block id="your-gateway" eyebrow="Works with your AI gateway" title="Keep LiteLLM, Portkey or Kong. Add the evidence.">
          <p className="m-0">Your gateway keeps routing, keys and budgets, and calls Probaline’s checks before and after the model. Probaline applies your rules, removes secrets and personal data, and writes the case file, marked with the gateway it came from.</p>
          <p className="m-0"><Status value="Beta" className="mr-2" />LiteLLM, Portkey and Kong AI Gateway, or anything that can call an HTTP guardrail.</p>
        </Block>
      </Container>
      <ClosingCta />
    </>
  );
}
