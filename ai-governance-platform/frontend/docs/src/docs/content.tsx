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
        <P>Probaline is a gateway between your company and AI providers. Every request passes the same checks, in the same order, before anything leaves:</P>
        <ol className="my-3 pl-6 flex flex-col gap-2 text-[16px] leading-relaxed">
          <li><strong>Policy rules.</strong> Your words and phrases, patterns, approved models and personal-data types. A match <strong className="text-stop">stops</strong> the request.</li>
          <li><strong>Secrets.</strong> API keys, tokens, private keys and passwords. By default a match <strong className="text-stop">stops</strong> the request; your company can choose to remove them and send the rest. See <Link to="/docs/secrets" className="font-semibold text-ink">Secrets</Link>.</li>
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
        <P>The gateway speaks the OpenAI chat completions format. Change the base URL and use your Probaline key:</P>
        <Code label="curl">{`curl https://gateway.example.com/v1/chat/completions \\
  -H "Authorization: Bearer $PROBALINE_API_KEY" \\
  -H "X-App-Id: support-bot" \\
  -H "X-User-Id: jane@example.com" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "Hello"}]}'`}</Code>
        <Code label="OpenAI SDK (Python)">{`from openai import OpenAI

client = OpenAI(
    base_url="https://gateway.example.com/v1",
    api_key=os.environ["PROBALINE_API_KEY"],
    default_headers={"X-App-Id": "support-bot"},
)`}</Code>
        <P><C>X-App-Id</C> names the app in the dashboard. <C>X-User-Id</C> says which of your app’s users the request is for; it’s recorded for attribution, not used for authentication.</P>
        <P>Streaming works as with OpenAI: send <C>stream: true</C> and the answer arrives as server-sent events. Personal data in the answer is removed as it streams.</P>
        <Note><strong>Not yet supported:</strong> image or file inputs.</Note>
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
        <P>Developers’ tools call providers directly with the developer’s own key. In proxy mode, your corporate proxy routes those calls through Probaline, which checks them and forwards them unchanged.</P>
        <H2>How a request is routed</H2>
        <Code>{`https://api.openai.com/v1/chat/completions
  → https://gateway.example.com/v1/proxy/openai/v1/chat/completions`}</Code>
        <P>Supported providers in the path: <C>openai</C>, <C>anthropic</C>, <C>cohere</C>, <C>mistral</C>.</P>
        <H2>Authentication</H2>
        <P>The developer’s <C>Authorization</C> or <C>x-api-key</C> header is the provider key and is passed through untouched. Your proxy adds the Probaline key in a separate header:</P>
        <Code>{`X-Probaline-Key: <a Probaline API key with the chat permission>`}</Code>
        <P>Requests without <C>X-Probaline-Key</C> are rejected. Prompts sent as content blocks and Anthropic system prompts are checked like any other text.</P>
        <Note>Proxy mode is in beta. Streamed answers pass straight through after the request is checked. Proxy mode applies your rules and the secrets check (stopping the request, or removing the secret from the body before it’s forwarded) but doesn’t remove personal data.</Note>
      </>
    ),
  },
  {
    slug: 'browser-extension',
    title: 'Browser extension and shadow AI',
    summary: 'See and control AI tools used outside the gateway.',
    body: (
      <>
        <P>The Probaline extension for Chrome records which AI tools, such as ChatGPT, Claude, Gemini and Perplexity, are opened in your company’s browsers. It blocks only the tools you decide to block, and points people to the ones you approve.</P>
        <P>It records the tool’s domain, the time and whether it was blocked. It never records the page address, what people type or what the tool answers. Repeat visits to the same tool within ten minutes count once.</P>
        <H2>1. Create an extension key</H2>
        <P>In <strong>More → API keys</strong>, create a key with only the <C>shadow_ai:ingest</C> permission. It can report visits and read the extension’s settings, nothing else.</P>
        <H2>2. Push it with Chrome policy</H2>
        <P>Force-install the extension with Google Admin, Intune or Jamf and set these managed values. Employees can’t change them, and the extension finds your company from the key.</P>
        <Table head={['Key', 'Value']} rows={[
          [<C>gatewayUrl</C>, 'Your gateway address'],
          [<C>apiKey</C>, 'The extension key from step 1'],
          [<C>identifyUsers</C>, <><C>true</C> to report the work email each Chrome profile is signed in with. Leave it off and each browser reports as a random ID.</>],
        ]} />
        <H2>3. Decide tool by tool</H2>
        <P>The Shadow AI page lists each tool with visits, people and the trend. It starts in <strong>Watch only</strong>: nothing is blocked until you decide. <strong>Block</strong> stops a tool in every browser; <strong>Allow</strong> stops recording it and adds it to the approved list. The extension picks up changes within five minutes.</P>
        <H2>4. Say what people should use instead</H2>
        <P>When the extension blocks a tool, it shows a page with your message and links to approved tools: your own (an internal assistant or your enterprise ChatGPT workspace, for example) followed by the tools you allowed. Set them under <strong>When the extension blocks a tool</strong> on the Shadow AI page.</P>
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
    slug: 'secrets',
    title: 'Secrets',
    summary: 'API keys, tokens, private keys and passwords in prompts.',
    body: (
      <>
        <P>Check 2 looks for credentials pasted into prompts: someone debugging with a live cloud key, a config file with a database password, a private key. It runs inside the gateway, on every message of the conversation, in both the app endpoint and proxy mode.</P>
        <H2>What it finds</H2>
        <Table head={['Kind', 'Examples']} rows={[
          ['Cloud keys', 'AWS access and secret keys, Azure storage and shared access keys, Google API keys and OAuth client secrets'],
          ['AI provider keys', 'OpenAI, Anthropic, Hugging Face'],
          ['Developer and SaaS tokens', 'GitHub, GitLab, npm, Slack tokens and webhooks, Stripe live keys, SendGrid, Twilio, Shopify'],
          ['Private keys', 'RSA, EC, DSA, OpenSSH, PGP and encrypted private key blocks, even when cut off'],
          ['Access tokens', 'JSON Web Tokens (JWTs)'],
          ['Passwords', 'Database connection strings with a password, and lines like password = …, api_key: …, client_secret = …'],
        ]} />
        <P>Patterns are chosen so a match is almost always a real credential. Obvious stand-ins are ignored: the AWS documentation key ending in EXAMPLE, <C>xxxx</C>, <C>&lt;your-key&gt;</C>, <C>{'${DB_PASSWORD}'}</C>, <C>config.password</C> and <C>process.env.API_KEY</C>.</P>
        <H2>What happens</H2>
        <Table head={['Setting', 'The request', 'The app sees']} rows={[
          ['Stop the request (default)', 'Never reaches the provider', <>403 <C>SECRET_DETECTED</C>, with a message naming the kind of secret, never the secret</>],
          ['Remove, then send', <>Each secret is replaced with a marker such as <C>[REDACTED aws_access_key]</C>; personal data is then removed as usual</>, 'A normal answer'],
          ['Off', 'Not checked', 'A normal answer'],
        ]} />
        <P>Admins change this on the <strong>Rules</strong> page, under check 2. The change applies within a minute.</P>
        <H2>What is recorded</H2>
        <P>The secret itself is never stored, not in evidence, logs or excerpts. A stopped request’s case file shows the kind of secret (for example <C>[AWS access key]</C>) with the words around it. Excerpts kept by your other rules are also scrubbed of any secret before they’re saved.</P>
        <Note>A stopped secret was still typed into a tool. If it’s a live production key, treat it as exposed to the person’s machine and rotate it as your process requires.</Note>
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
          ['Which kinds of secret were found, and whether they were stopped or removed', 'Any API key, token, private key or password, anywhere'],
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
    slug: 'collectors',
    title: 'Collectors and the AI usage assessment',
    summary: 'Find AI use in logs a company already has, and build the assessment report inside their environment.',
    body: (
      <>
        <P>The collector is separate from the gateway and needs nothing else installed. It reads logs where they already are, keeps only lines that match a known AI service as daily counts, and builds an HTML report in the customer’s own storage. Nothing is sent to Probaline.</P>
        <H2>What it keeps</H2>
        <P>Daily counts per AI service, source and caller. Servers keep the name the log gives them; people become codes such as <C>user-3f9a…</C>, made with a key that stays in the customer’s <C>private/</C> folder with the code-to-name lookup.</P>
        <H2>AWS</H2>
        <P>Deploy <C>collector/deploy/aws/collector.yaml</C> with the names of the log buckets. It reads Route 53 Resolver DNS query logs, Network Firewall logs and CloudTrail (Amazon Bedrock and SageMaker calls). Turn on EventBridge notifications for each log bucket, put the Probaline gateway’s role in <C>Ignore</C>, then run the backfill command from the stack outputs. The report is at <C>reports/latest.html</C> in the results bucket.</P>
        <H2>On-premises</H2>
        <P>Run the container from <C>collector/deploy/onprem</C>. Point firewalls and proxies at it over syslog (UDP or TCP) and mount DNS server and proxy log folders under <C>/logs</C>.</P>
        <Table head={['Product', 'How it arrives']} rows={[
          ['Palo Alto Networks (URL filtering)', 'syslog'],
          ['Fortinet FortiGate (web filter, DNS)', 'syslog'],
          ['Check Point and other CEF sources', 'syslog'],
          ['Squid', 'access log file'],
          ['BIND, Windows DNS', 'query log files'],
        ]} />
        <H2>Not built yet</H2>
        <P>Azure, Google Cloud, Zscaler, Netskope, Microsoft 365, Google Workspace and Okta/Entra sources, and sending results to a Probaline install. See <C>docs/ASSESSMENT.md</C> in the repository.</P>
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
          [<C>ANY /v1/proxy/:provider/*</C>, 'Proxy mode (needs X-Probaline-Key)'],
        ]} />
        <H2>Headers</H2>
        <Table head={['Header', 'Meaning']} rows={[
          [<C>Authorization: Bearer …</C>, 'Your Probaline API key (in proxy mode, the provider key)'],
          [<C>X-Probaline-Key</C>, 'Your Probaline API key, proxy mode only'],
          [<C>X-App-Id</C>, 'Optional app name shown in the dashboard'],
          [<C>X-User-Id</C>, 'Optional end-user ID, for attribution'],
        ]} />
        <H2>Errors</H2>
        <Table head={['Status', 'Code', 'Meaning']} rows={[
          ['401', <C>MISSING_AUTH</C>, 'No key sent'],
          ['401', <C>INVALID_KEY</C>, 'Unknown, revoked or expired key'],
          ['403', <C>POLICY_VIOLATION</C>, 'A rule stopped the request; the message is the rule’s name'],
          ['403', <C>SECRET_DETECTED</C>, 'The prompt contains a credential; the message names its kind, never its value'],
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
