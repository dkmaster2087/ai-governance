import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Code } from '../components/ui';

export interface DocPage {
  slug: string;
  title: string;
  summary: string;
  body: ReactNode;
}

const H2 = ({ children }: { children: ReactNode }) => <h2 className="m-0 mt-10 mb-3 text-[24px] font-bold tracking-[-0.015em]">{children}</h2>;
const P = ({ children }: { children: ReactNode }) => <p className="m-0 my-3 text-[16px] leading-relaxed">{children}</p>;
const C = ({ children }: { children: ReactNode }) => <code className="font-mono text-[13px] bg-ink-tint rounded px-1.5 py-px">{children}</code>;
const Note = ({ children }: { children: ReactNode }) => (
  <div className="my-5 border-l-[3px] border-ink bg-canvas rounded-r-lg px-4 py-3 text-[15px] leading-relaxed">{children}</div>
);

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-[15px]">
        <thead><tr>{head.map((h) => <th key={h} className="text-left font-semibold border-b-2 border-ink py-2 pr-4">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border-b border-line py-2 pr-4 align-top">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export const DOCS: DocPage[] = [
  {
    slug: '',
    title: 'Overview',
    summary: 'What the gateway does to each request, in order.',
    body: (
      <>
        <P>Aegis is a gateway between your company and AI providers. Every request passes the same checks, in the same order, before anything leaves:</P>
        <ol className="my-3 pl-6 flex flex-col gap-2 text-[16px] leading-relaxed">
          <li><strong>Policy rules.</strong> Your words and phrases, patterns, approved models and personal-data types. A match <strong className="text-stop">stops</strong> the request.</li>
          <li><strong>Secrets.</strong> API keys, tokens and private keys. <em>Coming next</em>; today the dashboard shows this check as not active.</li>
          <li><strong>Personal data.</strong> Emails, phone numbers, Social Security and card numbers are removed in place, then the request is sent.</li>
        </ol>
        <P>Every decision is recorded as evidence. A browser extension separately shows AI use that goes around the gateway.</P>
        <H2>Where to start</H2>
        <ul className="my-3 pl-6 flex flex-col gap-1.5 text-[16px]">
          <li><Link to="/docs/quick-start" className="font-semibold text-ink">Connect your first app</Link> in a few minutes.</li>
          <li><Link to="/docs/proxy-mode" className="font-semibold text-ink">Govern IDE traffic</Link> through your corporate proxy.</li>
          <li><Link to="/docs/browser-extension" className="font-semibold text-ink">Roll out the browser extension</Link> to find shadow AI.</li>
        </ul>
      </>
    ),
  },
  {
    slug: 'quick-start',
    title: 'Quick start',
    summary: 'Send your first request through the gateway.',
    body: (
      <>
        <H2>1. Create an API key</H2>
        <P>In the dashboard, open <strong>More → API keys</strong> and create a key with the <C>chat</C> permission. Copy it: it’s shown once.</P>
        <H2>2. Add a model</H2>
        <P>Open <strong>More → Models &amp; keys</strong> and add the models your apps use, from Amazon Bedrock or OpenAI. For OpenAI, paste your API key; it’s stored in AWS Secrets Manager. Bedrock models use the gateway’s AWS role and need no key. To refuse every other model, add an <strong>Approved models</strong> rule.</P>
        <H2>3. Point your app at the gateway</H2>
        <P>The gateway speaks the OpenAI chat completions format. Change the base URL and use your Aegis key:</P>
        <Code label="curl">{`curl https://gateway.example.com/v1/chat/completions \\
  -H "Authorization: Bearer $AEGIS_API_KEY" \\
  -H "X-App-Id: support-bot" \\
  -H "X-User-Id: jane@example.com" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "Hello"}]}'`}</Code>
        <Code label="OpenAI SDK (Python)">{`from openai import OpenAI

client = OpenAI(
    base_url="https://gateway.example.com/v1",
    api_key=os.environ["AEGIS_API_KEY"],
    default_headers={"X-App-Id": "support-bot"},
)`}</Code>
        <P><C>X-App-Id</C> names the app in the dashboard. <C>X-User-Id</C> says which of your app’s users the request is for; it’s recorded for attribution, not used for authentication.</P>
        <Note><strong>Not yet supported:</strong> streaming responses (<C>stream: true</C> returns a complete response) and image or file inputs.</Note>
        <H2>4. Watch it on the Gateway page</H2>
        <P>Requests appear within seconds. Try a prompt containing the word “confidential” with the default rule switched on: it comes back as <C>403 POLICY_VIOLATION</C> and shows up on the Stopped page.</P>
      </>
    ),
  },
  {
    slug: 'proxy-mode',
    title: 'IDEs and proxy mode',
    summary: 'Govern Cursor, Copilot and other tools without changing them.',
    body: (
      <>
        <P>Developers’ tools call providers directly with the developer’s own key. In proxy mode, your corporate proxy routes those calls through Aegis, which checks them and forwards them unchanged.</P>
        <H2>How a request is routed</H2>
        <Code>{`https://api.openai.com/v1/chat/completions
  → https://gateway.example.com/v1/proxy/openai/v1/chat/completions`}</Code>
        <P>Supported providers in the path: <C>openai</C>, <C>anthropic</C>, <C>cohere</C>, <C>mistral</C>.</P>
        <H2>Authentication</H2>
        <P>The developer’s <C>Authorization</C> or <C>x-api-key</C> header is the provider key and is passed through untouched. Your proxy adds the Aegis key in a separate header:</P>
        <Code>{`X-Aegis-Key: <an Aegis API key with the chat permission>`}</Code>
        <P>Requests without <C>X-Aegis-Key</C> are rejected. Prompts sent as content blocks and Anthropic system prompts are checked like any other text.</P>
        <Note>Proxy mode is in beta. Responses are returned complete rather than streamed, which some IDE features expect; streaming support is next on the roadmap.</Note>
      </>
    ),
  },
  {
    slug: 'browser-extension',
    title: 'Browser extension and shadow AI',
    summary: 'See and control AI tools used outside the gateway.',
    body: (
      <>
        <P>The Aegis extension for Chrome records visits to AI tools such as ChatGPT, Claude, Gemini and Perplexity, and blocks the ones you decide to block.</P>
        <H2>1. Create an extension key</H2>
        <P>In <strong>More → API keys</strong>, create a key with only the <C>shadow_ai:ingest</C> permission. It can report visits and read the extension’s settings, nothing else.</P>
        <H2>2. Push it with Chrome policy</H2>
        <P>Deploy the extension with Google Admin, Intune or Jamf and set these managed values. Values set by policy can’t be changed by employees.</P>
        <Table head={['Key', 'Value']} rows={[
          [<C>tenantId</C>, 'Your company’s tenant ID'],
          [<C>apiKey</C>, 'The extension key from step 1'],
          [<C>gatewayUrl</C>, 'Your gateway address'],
          [<C>platformUrl</C>, 'Your dashboard address (blocked tools redirect to its “not approved” page)'],
          [<C>mode</C>, <><C>monitor</C> or <C>block</C>: what to do with tools you haven’t decided on</>],
        ]} />
        <H2>3. Decide tool by tool</H2>
        <P>The Shadow AI page lists each tool with visits, people and the trend. <strong>Block</strong> stops it in every browser; <strong>Allow</strong> stops recording it. The extension picks up changes within five minutes.</P>
        <P>Only browsers with the extension are counted. Visits are kept for 30 days.</P>
      </>
    ),
  },
  {
    slug: 'rules',
    title: 'Rules',
    summary: 'What rules can match, and what happens when they do.',
    body: (
      <>
        <P>Rules run in order on every request. The first rule that stops a request ends the check; its name is what people see.</P>
        <Table head={['Rule', 'Stops a prompt when…']} rows={[
          ['Words or phrases', 'it contains any of the listed words, ignoring case'],
          ['A pattern', 'it matches a regular expression you provide (slow or invalid patterns are refused)'],
          ['Approved models', 'it asks for a model not on the list'],
          ['Personal data', 'it contains the chosen types: emails, phone numbers, SSNs, card numbers, names, dates of birth or medical record numbers'],
        ]} />
        <H2>Flag-only rules</H2>
        <P>Rules from compliance frameworks may <em>flag</em> a request instead of stopping it. The Rules page says so on each one, with how often it fired.</P>
        <H2>Controls the gateway doesn’t check</H2>
        <P>Some framework controls, such as “log every request”, describe practices rather than checks. They’re listed separately, so the rules list never looks more protective than it is.</P>
        <H2>If a check can’t run</H2>
        <P>By default the request is <strong>blocked</strong>. Choose “Let it through, flagged” on the Rules page to send it anyway; each one is marked in its evidence record.</P>
      </>
    ),
  },
  {
    slug: 'personal-data',
    title: 'Personal data',
    summary: 'What gets removed before prompts leave.',
    body: (
      <>
        <P>Check 3 removes emails, phone numbers, Social Security numbers and payment card numbers from every prompt, replacing them with placeholders, then sends it on. Card numbers are verified with a checksum so order numbers and timestamps are left alone.</P>
        <P>To <strong>stop</strong> prompts with personal data instead of cleaning them, add a Personal data rule.</P>
        <P>Each cleaned request is counted on the Gateway page and marked “Cleaned” in Evidence.</P>
      </>
    ),
  },
  {
    slug: 'evidence',
    title: 'Evidence',
    summary: 'What is recorded about each request, and for how long.',
    body: (
      <>
        <P>Every request gets a record: who sent it, from which app, to which model, what happened at each check, and the outcome.</P>
        <Table head={['Recorded', 'Not recorded']} rows={[
          ['A SHA-256 fingerprint of the prompt and response', 'The text of prompts that were delivered'],
          ['For stopped requests, about 60 characters either side of the trigger, with personal data masked', 'Personal data that triggered a rule (only its type, such as [SSN])'],
          ['Token counts, timing and estimated cost', ''],
        ]} />
        <P>Records are kept for your plan’s retention period. <strong>Download evidence</strong> on any record produces a JSON file with the full case file, who exported it and when.</P>
      </>
    ),
  },
  {
    slug: 'access',
    title: 'Roles and API keys',
    summary: 'Who can see and change what.',
    body: (
      <>
        <Table head={['Role', 'Can']} rows={[
          ['Admin', 'Everything for their company: rules, decisions, models, API keys, users'],
          ['Auditor', 'Read the Gateway, Stopped and Evidence pages; change nothing'],
          ['User', 'Use AI through approved apps; no dashboard access'],
        ]} />
        <Table head={['API key permission', 'Allows']} rows={[
          [<C>chat</C>, 'Sending requests, including proxy mode'],
          [<C>models</C>, 'Listing available models'],
          [<C>shadow_ai:ingest</C>, 'The browser extension reporting visits and reading its settings'],
        ]} />
        <P>A key belongs to one company; using it with another company’s ID is refused. Keys can be set to expire and revoked at any time.</P>
      </>
    ),
  },
  {
    slug: 'api',
    title: 'API reference',
    summary: 'Endpoints, headers and errors.',
    body: (
      <>
        <H2>Sending requests</H2>
        <Table head={['Endpoint', 'Purpose']} rows={[
          [<C>POST /v1/chat/completions</C>, 'OpenAI-compatible chat completion'],
          [<C>GET /v1/models</C>, 'Models your company allows'],
          [<C>ANY /v1/proxy/:provider/*</C>, 'Proxy mode (needs X-Aegis-Key)'],
        ]} />
        <H2>Headers</H2>
        <Table head={['Header', 'Meaning']} rows={[
          [<C>Authorization: Bearer …</C>, 'Your Aegis API key (in proxy mode, the provider key)'],
          [<C>X-Aegis-Key</C>, 'Your Aegis API key, proxy mode only'],
          [<C>X-App-Id</C>, 'Optional app name shown in the dashboard'],
          [<C>X-User-Id</C>, 'Optional end-user ID, for attribution'],
        ]} />
        <H2>Errors</H2>
        <Table head={['Status', 'Code', 'Meaning']} rows={[
          ['401', <C>MISSING_AUTH</C>, 'No key sent'],
          ['401', <C>INVALID_KEY</C>, 'Unknown, revoked or expired key'],
          ['403', <C>POLICY_VIOLATION</C>, 'A rule stopped the request; the message is the rule’s name'],
          ['403', <C>TENANT_MISMATCH</C>, 'The key belongs to another company'],
          ['403', <C>FORBIDDEN</C>, 'The key lacks the needed permission'],
          ['429', '—', 'Rate limit reached; retry after the stated time'],
          ['503', <C>GOVERNANCE_UNAVAILABLE</C>, 'A check couldn’t run and your company blocks in that case'],
        ]} />
      </>
    ),
  },
  {
    slug: 'self-hosting',
    title: 'Self-hosting',
    summary: 'Deploy into your own AWS account, or run it locally.',
    body: (
      <>
        <H2>In your AWS account</H2>
        <P>The repository includes AWS CDK stacks for the network, storage, sign-in and services. You’ll need a TLS certificate for the gateway’s public address.</P>
        <Code>{`cd infra
npm install
npx cdk bootstrap
npx cdk deploy --all --context stage=prod`}</Code>
        <H2>Locally, for evaluation</H2>
        <P>Runs everything on your machine with LocalStack, a stand-in model and sample traffic. Requires Docker and Node.js 20+.</P>
        <Code>{`scripts/dev-local.sh start
node scripts/seed-traffic.mjs
# dashboard: http://localhost:5174`}</Code>
      </>
    ),
  },
];
