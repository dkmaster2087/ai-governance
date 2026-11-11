import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Code } from '../components/ui';
import { GatewayFlow, McpFlow } from '../components/flows';

export interface DocPage {
  slug: string;
  title: string;
  summary: string;
  body: ReactNode;
}

const H2 = ({ children }: { children: ReactNode }) => <h2 className="m-0 mt-10 mb-3 text-[24px] font-bold tracking-[-0.015em]">{children}</h2>;
const P = ({ children }: { children: ReactNode }) => <p className="m-0 my-3 text-[16px] leading-relaxed">{children}</p>;
const C = ({ children }: { children: ReactNode }) => <code className="font-mono text-[13px] bg-ink-tint rounded px-1.5 py-px">{children}</code>;
/** A diagram on a light panel, full content width. */
const Figure = ({ children }: { children: ReactNode }) => (
  <div className="my-6 border border-line rounded-[14px] bg-white p-4 sm:p-5">{children}</div>
);
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
    summary: 'What the gateway checks, in both directions: prompts going out, and AI agents coming in.',
    body: (
      <>
        <P>Probaline is a gateway for AI traffic in both directions: <strong>out</strong>, when your apps, IDEs and people send prompts to AI providers, and <strong>in</strong>, when AI agents use your company’s systems through MCP. One set of company rules, one secrets check and one evidence trail cover both.</P>
        <H2>Going out: prompts to AI models</H2>
        <Figure><GatewayFlow /></Figure>
        <P>Every request passes the same checks, in the same order, before anything leaves:</P>
        <ol className="my-3 pl-6 flex flex-col gap-2 text-[16px] leading-relaxed">
          <li><strong>Policy rules.</strong> Your words and phrases, patterns, approved models and personal-data types. A match <strong className="text-stop">stops</strong> the request.</li>
          <li><strong>Secrets.</strong> API keys, tokens, private keys and passwords. By default a match <strong className="text-stop">stops</strong> the request; your company can choose to remove them and send the rest. See <Link to="/docs/secrets" className="font-semibold text-ink">Secrets</Link>.</li>
          <li><strong>Personal data.</strong> Emails, phone numbers, Social Security and card numbers are removed in place, then the request is sent.</li>
        </ol>
        <P>Every decision is recorded as evidence. A browser extension separately shows AI use that goes around the gateway.</P>
        <H2>Coming in: AI agents using your systems (MCP, beta)</H2>
        <Figure><McpFlow /></Figure>
        <P>Agents such as Claude, ChatGPT, Cursor and Copilot, or your own agents, connect to an MCP server you create in Probaline. They never reach your APIs directly. Each tool call is checked, in order:</P>
        <ol className="my-3 pl-6 flex flex-col gap-2 text-[16px] leading-relaxed">
          <li><strong>Sign-in.</strong> A person signed in through your identity provider, or an API key with the MCP permission, and allowed on this server. They see only the tools their groups may use. Anyone else is <strong className="text-stop">refused</strong>.</li>
          <li><strong>Arguments.</strong> Checked against the tool’s schema, then the secrets check and your company rules, the same ones prompts get. A match <strong className="text-stop">stops</strong> the call.</li>
          <li><strong>Approval.</strong> A tool that changes data waits for a person to approve that exact call. A refusal <strong className="text-stop">stops</strong> it.</li>
          <li><strong>Your API.</strong> Probaline calls it with its own credential and a signed statement of who asked, directly or through a connector inside your network.</li>
          <li><strong>Result.</strong> Personal data is removed, text that tries to instruct the agent is flagged, and the answer is cut at the size limit before the agent sees it.</li>
        </ol>
        <H2>The same policies, both ways</H2>
        <Table head={['', 'Prompts going out', 'Tool calls coming in']} rows={[
          ['Who', 'An API key per app; X-User-Id says which of its users, for attribution', 'A person signed in through your identity provider, or an API key with the mcp permission'],
          ['What they may use', 'Approved models rule', 'The server’s tools, limited to the caller’s groups'],
          ['Company rules', 'On the prompt: stop', 'On the arguments: stop'],
          ['Secrets', 'Stop, or remove and send the rest', 'Stop'],
          ['Personal data', 'Removed from the prompt and the answer', 'Removed from the result (unless the server is set to return it)'],
          ['A person decides', '—', 'Tools that change data wait for approval'],
          ['When a check can’t run', 'Your fail mode: block, or let through and flag', 'The same fail mode'],
          ['Evidence', 'A case file per request', 'A case file per call'],
        ]} />
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
        <P>Open <strong>More → Models &amp; keys</strong> and add the models your apps use, from Amazon Bedrock or OpenAI. For OpenAI, paste your API key; it’s stored encrypted (AWS Secrets Manager, or your database on a self-hosted install). Bedrock models use the gateway’s AWS role and need no key. To refuse every other model, add an <strong>Approved models</strong> rule.</P>
        <P>On each model you can also set the <strong>longest answer</strong> an app may ask for (larger requests are capped to it, so one request can’t run up the bill) and <strong>which API keys may use it</strong>. Other keys are refused with <C>MODEL_NOT_ALLOWED</C>, and the refusal is recorded in Evidence.</P>
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
        <P>On the Compliance page, every control says how it is covered: <strong>enforced by a rule</strong>, <strong>built into Probaline</strong> (such as a case file for every request), <strong>needs your action</strong> (such as listing the models covered by your BAA), or <strong>not covered yet</strong>. It’s worked out each time from what is switched on, so it never claims more than is true.</P>
        <P>HIPAA stops protected health information: health details together with who they’re about (a record number, labelled date of birth, member ID, contact details or a patient’s name). Health details on their own, and ordinary names, places and dates, aren’t stopped.</P>
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
    slug: 'alerts',
    title: 'Alerts',
    summary: 'Tell your team by email or webhook when something needs attention.',
    body: (
      <>
        <P>Administrators set up alerts on the <strong>Alerts</strong> page. Each alert watches one thing and sends to up to 10 email addresses, a webhook, or both.</P>
        <Table head={['Alert', 'Sent when']} rows={[
          ['Many requests stopped', 'A number of requests or tool calls are stopped within 15 minutes, an hour or a day.'],
          ['Personal data in AI answers', 'Personal data is removed from AI answers or tool results that many times in the window.'],
          ['Unapproved AI tools in use', 'The browser extension reports that many visits to AI tools you haven’t approved.'],
          ['Spend near budget', 'This month’s AI spend passes the share of the budget you set (once a month).'],
        ]} />
        <P>Each alert is sent once per window, however many more events follow. <strong>Send a test</strong> checks the email and webhook straight away and shows what happened; <strong>Recently sent</strong> lists the last 90 days.</P>
        <H2>Webhooks</H2>
        <P>Paste a Slack, Microsoft Teams or Google Chat incoming webhook address and the alert appears as a message. For your own endpoint, the JSON body has <C>kind</C>, <C>title</C>, <C>message</C> and <C>firedAt</C>, and the <C>x-probaline-signature</C> header is signed with a secret shown once when you save the webhook (the same scheme as log export). Addresses must be https and public.</P>
        <Note>Email needs your provider to have set up sending (Amazon SES). If it isn’t, the test says so.</Note>
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
          ['Auditor', 'Read the Gateway, Stopped, Evidence and Activity pages; change nothing'],
          ['User', 'Use AI through approved apps; no dashboard access'],
        ]} />
        <Table head={['API key permission', 'Allows']} rows={[
          [<C>chat</C>, 'Sending requests, including proxy mode'],
          [<C>models</C>, 'Listing available models'],
          [<C>shadow_ai:ingest</C>, 'The browser extension reporting visits and reading its settings'],
          [<C>mcp</C>, 'An AI agent using the tools on your MCP servers'],
        ]} />
        <P>A key belongs to one company; using it with another company’s ID is refused. Keys can be set to expire and revoked at any time.</P>
      </>
    ),
  },
  {
    slug: 'logs',
    title: 'Logs and SIEM export',
    summary: 'Admin activity, sign-ins, and sending your records to Splunk, Datadog, Elastic or any collector.',
    body: (
      <>
        <H2>Activity</H2>
        <P>The <strong>Activity</strong> page lists every change made in Probaline (rules, API keys, models, MCP servers, approvals, connectors, sign-in settings, log export) and every sign-in, with who did it, from which address and browser, and whether it went through or was refused. Admins and auditors can see it. Records are kept 400 days; each has a SHA-256 fingerprint and an archive copy.</P>
        <Table head={['Sign-in record', 'When']} rows={[
          [<C>sign_in.dashboard</C>, 'Once per dashboard sign-in, the first time the gateway sees it'],
          [<C>sign_in.api_key</C>, 'A revoked or expired key was used, or a key was used for another company (at most once a minute per key)'],
          [<C>sign_in.mcp</C>, 'Someone signed in to your MCP servers through your identity provider: success, failure, or no access'],
          [<><C>sign_in.mcp_agent_allowed</C>, <C>…_refused</C></>, 'The person allowed or refused an agent'],
          [<C>sign_in.mcp_refresh_reused</C>, 'A sign-in token was used twice; the sign-in was ended'],
        ]} />
        <Note>Wrong dashboard passwords are checked by your sign-in provider, not Probaline. In AWS they are CloudTrail events from Amazon Cognito. Requests with unknown API keys can’t be tied to a company, so they aren’t listed.</Note>
        <H2>Log export (beta)</H2>
        <P>On <strong>Log export</strong>, an admin adds up to five destinations and chooses what each receives: <strong>decisions</strong> (every AI request and MCP tool call, allowed or stopped, and why), <strong>admin activity</strong> and <strong>sign-ins</strong>. Records go out in batches of up to 100 within about a minute. Prompts, answers and stop excerpts are never sent. Records from before a destination is added aren’t sent.</P>
        <Table head={['Destination', 'Format', 'Use for']} rows={[
          ['HTTPS webhook', 'POST of a JSON batch, signed', 'Your own endpoint, Sumo Logic HTTP source, any HTTP collector'],
          ['Splunk HEC', <><C>/services/collector/event</C>, one event per line, <C>Authorization: Splunk &lt;token&gt;</C>, sourcetype <C>probaline:&lt;type&gt;</C></>, 'Splunk Enterprise, Splunk Cloud'],
          ['OpenTelemetry', <>OTLP/HTTP JSON to <C>/v1/logs</C>, your headers</>, 'An OpenTelemetry Collector, Datadog, Elastic, Grafana; Microsoft Sentinel and syslog through a Collector'],
        ]} />
        <H2>Record fields</H2>
        <P>Every record, whatever its type and destination, has the same fields (schema <C>probaline.log/1</C>):</P>
        <Code>{`{
  "schema": "probaline.log/1",
  "id": "act_3f9c…",              // stable: use it to drop duplicates
  "type": "admin_activity",        // decision | admin_activity | sign_in
  "time": "2026-11-06T10:15:02.114Z",
  "tenantId": "tenant_acme",
  "action": "api_key.revoked",     // ai.request, mcp.tool_call, rule.created, sign_in.api_key…
  "outcome": "success",            // decisions: allowed | stopped; others: success | denied | failure
  "actor": { "type": "user", "id": "…", "email": "ana@acme.com", "role": "tenant_admin" },
  "target": { "keyId": "key_9a1…" },
  "requestId": "…",
  "source": { "ip": "203.0.113.5", "userAgent": "…" },
  "detail": { "status": 200, "recordHash": "…" }
}`}</Code>
        <H2>Checking the webhook signature</H2>
        <P>A webhook batch is <C>{'{ "schema": "probaline.batch/1", "batchId", "sentAt", "count", "records": [ … ] }'}</C>. The <C>x-probaline-signature</C> header is <C>t=&lt;unix time&gt;,v1=&lt;hex&gt;</C>, where the hex is HMAC-SHA256 of <C>t.body</C> with your signing secret (shown once when you add the webhook; replace it any time). Refuse old timestamps.</P>
        <Code>{`const [t, v1] = header.split(',').map((p) => p.split('=')[1]);
const expected = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'))
  && Math.abs(Date.now() / 1000 - Number(t)) < 300;`}</Code>
        <H2>Delivery</H2>
        <P>Delivery is at least once. A destination that doesn’t answer 2xx is retried after 30 seconds, then 1, 2 and 4 minutes; after the fifth try the batch is listed under <strong>Not delivered</strong> for 30 days, where you can send it again, download it or discard it, and later records carry on. <strong>Send a test</strong> sends one sample record and shows the answer. Addresses must be https and public; tokens, headers and the address itself are kept in the secret store.</P>
        <H2>Service logs (self-hosted)</H2>
        <P>Probaline’s own services write one JSON object per line to stdout. In AWS they go to CloudWatch log groups <C>/ecs/&lt;prefix&gt;-&lt;service&gt;-&lt;stage&gt;</C> (kept a month). To send them to your SIEM, add a CloudWatch subscription filter on each log group to Amazon Data Firehose, which delivers to Splunk, Datadog, Elastic, Sumo Logic, an HTTP endpoint or S3 (Microsoft Sentinel reads from S3). Send CloudTrail the same way for Cognito sign-ins. Off AWS, collect stdout with an OpenTelemetry Collector or Fluent Bit.</P>
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
        <H2>Share through Probaline</H2>
        <P>The report opens with the share of AI traffic that goes through Probaline, for apps calling model APIs and for cloud AI services (Bedrock, SageMaker, Azure OpenAI, Vertex AI). Name the gateway and connector with <C>--gateway</C> (<C>GATEWAY</C> in the deployed collectors): <C>role:probaline-gateway-task</C>, an outbound address or range such as <C>ip:203.0.113.0/28</C>, or <C>host:gw-*</C>. Their traffic is compared with everything else in the same log, so the share is never a mix of units. Each path lists the callers still going direct and the fix, and later reports show the earlier shares.</P>
        <P>Browser use isn’t counted here; the browser extension governs it. Use <C>--ignore</C> only for other known-good callers: ignoring the gateway hides the traffic that proves the share.</P>
        <H2>AWS</H2>
        <P>Deploy <C>collector/deploy/aws/collector.yaml</C> with the names of the log buckets. It reads Route 53 Resolver DNS query logs, Network Firewall logs and CloudTrail (Amazon Bedrock and SageMaker calls). Turn on EventBridge notifications for each log bucket, put the Probaline gateway’s role in <C>Gateway</C>, then run the backfill command from the stack outputs. The report is at <C>reports/latest.html</C> in the results bucket.</P>
        <P>Other products’ logs that are streamed into one of those buckets (Netskope transaction logs, for example) are read too.</P>
        <H2>On-premises</H2>
        <P>Run the <C>probaline/collector</C> image on any Linux host with Docker (an example Compose file is in <C>collector/deploy/onprem</C>). Point firewalls and proxies at it over syslog (UDP or TCP) and mount DNS server and proxy log folders under <C>/logs</C>; results stay in its <C>/data</C> volume.</P>
        <Code>{`docker run -d --name probaline-collector --restart unless-stopped \
  -p 514:5514/udp -p 514:5514/tcp -e COMPANY=Acme \
  -v probaline-data:/data -v /var/log/squid:/logs/squid:ro -e WATCH_DIR=/logs \
  probaline/collector:0.1.0`}</Code>
        <Table head={['Product', 'How it arrives']} rows={[
          ['Palo Alto Networks (URL filtering)', 'syslog'],
          ['Fortinet FortiGate (web filter, DNS)', 'syslog'],
          ['Check Point and other CEF or LEEF sources', 'syslog'],
          ['Squid', 'access log file'],
          ['BIND, Windows DNS', 'query log files'],
        ]} />
        <P>Use TCP for busy senders; UDP syslog drops lines when a burst outpaces it.</P>
        <H2>Zscaler and Netskope (beta)</H2>
        <P>These see laptops wherever they are, which firewall and DNS logs miss once people leave the office. They use the same container, or the AWS collector; nothing new to install. Both are in beta: they read the formats these products document, but haven’t yet been run on a customer’s logs.</P>
        <Table head={['Product', 'Send it as', 'Fields used']} rows={[
          ['Zscaler Internet Access', 'An NSS web log feed to the container over TCP syslog (port 5514), in the JSON, LEEF, key=value or CEF format', <><C>hostname</C> or <C>url</C>, <C>login</C>, <C>cip</C>, <C>epochtime</C> or <C>datetime</C>, <C>requestsize</C></>],
          ['Netskope events', 'Cloud Log Shipper to the container over syslog, as JSON or CEF', <><C>domain</C> or <C>url</C>, <C>ur_normalized</C> or <C>user</C>, <C>srcip</C>, <C>timestamp</C>, <C>client_bytes</C></>],
          ['Netskope transaction logs', 'Log streaming to a folder the container watches, or to an S3 bucket the AWS collector reads; CSV with a header row or W3C with #Fields, plain or .gz', <><C>cs-host</C> or <C>cs-uri</C>, <C>cs-username</C>, <C>c-ip</C>, <C>date</C> + <C>time</C>, <C>cs-bytes</C></>],
        ]} />
        <P>A file’s header row is remembered while the file is followed, including after a restart. Zscaler or Netskope lines sent as CEF are labelled with their product in the report.</P>
        <H2>Azure and Google Cloud (beta)</H2>
        <P>A scheduled container job runs in the customer’s own cloud, reads the logs where the cloud already stores them, and writes the report to a private container or bucket of theirs. It signs in with its own managed identity or service account, read-only on the logs. Neither has run in a real subscription or project yet.</P>
        <Table head={['Cloud', 'Logs read', 'Deploy']} rows={[
          ['Microsoft Azure', 'Azure Firewall application rule and DNS proxy logs; DNS security policy logs; Azure OpenAI / AI Foundry request logs (model calls by person, app or IP). Turn on diagnostic settings to a storage account.', <><C>collector/deploy/azure/collector.bicep</C>: a Container Apps job</>],
          ['Google Cloud', 'Cloud DNS query logs (by VM); Secure Web Proxy logs; Data Access audit logs for Vertex AI and the Gemini API (model calls by service account or person). Sink them to a Cloud Storage bucket.', <><C>collector/deploy/gcp/deploy.sh</C>: a Cloud Run job, hourly, with optional sinks</>],
        ]} />
        <P>Exported files can also be read by the command-line tool or the on-premises container, with no cloud job at all.</P>
        <H2>Work apps and identity providers (beta)</H2>
        <P>Sign-in and audit logs show AI use that never passes a firewall: sign-ins to AI apps, Copilot and Gemini inside apps the company already pays for, and people letting AI apps reach company data. They name apps rather than web addresses, so app names (“ChatGPT Enterprise”, “Claude for Work”) are matched against the catalog.</P>
        <Table head={['Source', 'Give the collector', 'Shows']} rows={[
          ['Microsoft 365', 'Unified audit log records (Management Activity API, Sentinel) or a Purview audit search CSV export', 'Copilot use per person and app'],
          ['Google Workspace', 'Reports API activity (token, saml, Gemini)', 'Gemini use; AI apps given access to Drive or Gmail; SSO to AI apps'],
          ['Okta', 'System Log events', 'Sign-ins and OAuth consent to AI apps'],
          ['Microsoft Entra ID', 'Sign-in and audit logs from Graph, or a diagnostic setting to a storage account', 'Sign-ins to AI apps; consent to AI apps'],
          ['Any other identity provider', 'A CSV or JSON sign-in export with user and app columns', 'Sign-ins to AI apps (OneLogin, Ping, JumpCloud, Duo, Auth0, …)'],
        ]} />
        <P>These come from exports today; pulling them straight from each product’s API is planned.</P>
        <H2>Try it with sample data</H2>
        <Code>{`node collector/scripts/sample-sse-logs.mjs files ./sample-sse 14
node collector/dist/cli.js collect --out ./results ./sample-sse
node collector/dist/cli.js report --out ./results --company "Acme"
# open results/reports/latest.html`}</Code>
        <P>The same works with <C>sample-aws-logs.mjs</C>, <C>sample-onprem-logs.mjs</C> and <C>sample-cloud-logs.mjs</C> (Azure and Google Cloud) and <C>sample-workapp-logs.mjs</C> (Microsoft 365, Google Workspace, Okta, Entra, another identity provider). All sample data is made up.</P>
        <H2>Not built yet</H2>
        <P>Reading work-app logs straight from their APIs, and sending results to a Probaline install. See <C>docs/ASSESSMENT.md</C> in the repository.</P>
      </>
    ),
  },
  {
    slug: 'locking-ai-traffic',
    title: 'Locking AI traffic',
    summary: 'Make Probaline the only way AI leaves: a domain feed for firewalls and an AWS policy, previewed against your own logs.',
    body: (
      <>
        <P>Routing apps through Probaline is the first half. The second is closing the other paths, so the collector report’s share through Probaline can reach 100%. Probaline writes the rules; you apply them in tools you already run. Both are in beta. Open <strong>Enforcement</strong> in the dashboard.</P>
        <H2>One row per path</H2>
        <P>The page lists each way AI can go around Probaline: apps calling model APIs over the internet, apps in AWS calling Bedrock or SageMaker, and people in browsers going out; agents calling your APIs and MCP servers on laptops coming in (those two are coming). For each, you set <strong>Open</strong>, <strong>Previewing</strong> or <strong>Locked</strong>; beside it the page shows what your logs say: the share through Probaline, the trend, and who still goes direct. When a path is marked locked but traffic still goes direct in findings after that day, or no findings have come in since, the row says so.</P>
        <H2>Findings files</H2>
        <P>After each collector run, upload <C>reports/findings-&lt;day&gt;.json</C>. Probaline keeps the share per path, the services in use and who still goes direct (no log lines; people stay as codes) for 400 days, up to 100 files. The latest is used to preview each lock: who it would stop before you apply it.</P>
        <H2>Firewalls, web gateways and DNS: the AI-domain feed</H2>
        <P>A feed is a list of AI domains from the Probaline catalog, by kind (model APIs, chat apps, coding assistants, cloud AI endpoints, AI in work apps), minus the tools you allowed on the Shadow AI page. Your firewall fetches it by URL and blocks it for everyone except the gateway’s outbound addresses.</P>
        <Table head={['Format', 'For', 'Rule']} rows={[
          ['Domain list', 'Palo Alto Networks External Dynamic List, FortiGate external threat feed, Check Point', 'Block for all sources; allow the gateway’s addresses above it'],
          ['Zscaler', 'A custom URL category (JSON for the ZIA API)', 'URL filtering rule: block, except the gateway’s location'],
          ['Netskope', 'A URL list (JSON for the API)', 'Real-time Protection: block, with an exception for the gateway'],
          ['DNS RPZ', 'BIND, Infoblox, PowerDNS', 'Load as a response policy zone; exempt the gateway'],
          ['Hosts file', 'Single machines and labs', 'Exact names only, for testing'],
        ]} />
        <P>The address contains a long random token and is shown once. Anyone with it can read the list (public domain names only). Each feed shows when it was last fetched and from which address. <strong>New address</strong> stops the old one at once; <strong>Revoke</strong> deletes the feed.</P>
        <H2>AWS: only the gateway calls Bedrock and SageMaker</H2>
        <P>Enter the gateway’s IAM role and an emergency role. Probaline writes a service control policy that refuses <C>bedrock:InvokeModel*</C>, batch inference and <C>sagemaker:InvokeEndpoint*</C> to every other role, a matching VPC endpoint policy, and a CloudFormation template for your management account. AWS has no warn-only mode for these, so the page lists who would be refused, from your findings, first.</P>
        <P>Attach to one OU first. SCPs don’t apply to the management account or service-linked roles, and Bedrock agents and knowledge bases call models with their own roles: add those to the exceptions if you use them.</P>
        <H2>MCP servers on laptops</H2>
        <P>People add MCP servers to Claude Desktop, Claude Code, Cursor, VS Code and Windsurf with their own credentials, so those calls skip every company rule. The Enforcement page offers a read-only scan for device management (<C>mcp-scan.sh</C> for macOS, tested; <C>mcp-scan.ps1</C> for Windows, not yet tested). It prints the app, the server’s name, the package or the URL’s host, and whether it has credentials of its own, never their values. Give the output to the collector; the report lists the servers and which reach your own systems, and the Enforcement page shows how many laptops still have them.</P>
        <H2>Not built yet</H2>
        <P>Measuring direct calls to your APIs from their access logs; findings sent by the collector without an upload.</P>
      </>
    ),
  },
  {
    slug: 'locking-your-apis',
    title: 'Locking your APIs',
    summary: 'Accept only calls that came through Probaline, and know who asked: a check you add to each API.',
    body: (
      <>
        <P>An agent with the address of one of your APIs could call it directly and skip Probaline’s checks. Every call Probaline makes carries <C>X-Probaline-Identity</C>: a token the gateway signs, valid for five minutes, naming who asked (a person signed in with their company account, or a workload’s key), the MCP server, the tool, and Probaline’s request ID. Check it in the API and refuse calls without one. Beta.</P>
        <H2>Three steps</H2>
        <P>1. On the Enforcement page, under <strong>Your APIs</strong>, pick the API and a language. The code comes filled in with your gateway (the issuer) and the API’s base URL (the audience). 2. Deploy it with report-only on: calls without a valid token are logged, not refused. 3. When the log shows only Probaline’s calls, turn report-only off and mark “Agents calling your APIs directly” Locked.</P>
        <Table head={['Language', 'What', 'Tested']} rows={[
          ['Node', 'Express middleware and a Fastify hook; no dependencies', 'Yes, against tokens the gateway signs, and end to end'],
          ['AWS API Gateway', 'A Lambda authorizer for HTTP and REST APIs', 'Yes'],
          ['Python', 'FastAPI dependency and Flask decorator (PyJWT)', 'Yes'],
          ['Go', 'net/http middleware (golang-jwt, keyfunc)', 'Not yet'],
          ['Java', 'Spring servlet filter (spring-security-oauth2-jose)', 'Not yet'],
        ]} />
        <H2>What the check verifies</H2>
        <P>An ES256 signature from a key published at <C>&lt;gateway&gt;/.well-known/jwks.json</C> (never <C>none</C> or a shared secret), the token type <C>probaline-identity+jwt</C>, the issuer, the audience (so a token for one API can’t be used on another), and the expiry, with 30 seconds of clock leeway. For writes that must never repeat, also keep the token’s <C>jti</C> for five minutes and refuse a second use.</P>
        <H2>Without code changes</H2>
        <P>Allow only the gateway’s outbound addresses (or, for APIs reached through the connector, the connector’s host) in the API’s security group, WAF or proxy. That proves where a call came from, not who asked; use it alongside the check where you can.</P>
      </>
    ),
  },
  {
    slug: 'mcp',
    title: 'MCP servers',
    summary: 'Give AI agents your APIs as tools: people sign in, writes wait for approval, every call is checked and recorded.',
    body: (
      <>
        <P>An MCP server in Probaline is configuration, not code: create one in a minute, put one or more of your APIs behind it, and agents connect to its address. Agents only ever reach Probaline; your APIs are called by Probaline with its own credential, plus a signed statement of who asked. This is a beta.</P>
        <Figure><McpFlow /></Figure>
        <P>The checks are the ones prompts get, plus sign-in and approvals; <Link to="/docs" className="font-semibold text-ink">the overview</Link> compares the two directions.</P>
        <H2>Create one</H2>
        <ol className="my-3 pl-6 flex flex-col gap-2 text-[16px] leading-relaxed">
          <li>Open <strong>MCP servers</strong> → <strong>Create MCP server</strong>. Give it a name and a line on what it’s for (agents see it).</li>
          <li><strong>Add an API</strong>: its base URL, how Probaline reaches it (directly, or through a <strong>connector</strong> in your network), how Probaline signs in to it (bearer token or an API key header; kept in your secret store), and its OpenAPI 3 description (JSON or YAML). Each operation becomes a tool.</li>
          <li>Choose tools. Tools that read are on. Tools that change data are off until you turn them on; each then needs a person’s approval for every call, unless you choose <strong>Runs without approval</strong>. Any tool can be limited to groups.</li>
          <li>Set access: which people may sign in (nobody, everyone, or chosen groups) and which API keys may connect; calls per minute, the largest result, and whether personal data is removed from results (on by default).</li>
          <li>Try any tool in the test console, then <strong>Publish</strong>. Later changes are a draft until you publish them again; each publish is a version you can go back to.</li>
        </ol>
        <H2>People sign in</H2>
        <P>In <strong>MCP servers → Sign-in for people</strong>, connect your identity provider: Entra ID, Okta, Google or any OpenID Connect provider. Register Probaline there as a web application with the redirect address the page shows, and enter its issuer, client ID and secret, and the claim that holds groups. Add the <C>offline_access</C> scope so someone disabled in your provider loses access within 15 minutes.</P>
        <P>People then add the server’s address in their agent. Claude and ChatGPT: <strong>Settings → Connectors → Add custom connector</strong>. Claude Code:</P>
        <Code>{`claude mcp add --transport http hr-self-service https://<gateway>/mcp/<company>/hr-self-service
# then /mcp → Authenticate`}</Code>
        <P>They sign in with their company account, then see a Probaline page asking them to allow the agent. They get only the tools their groups allow.</P>
        <H2>Your own agents, with a key</H2>
        <P>Create an API key with <strong>Connect AI agents (MCP)</strong> in <strong>More → API keys</strong>, and send it as <C>Authorization: Bearer …</C>. Keys don’t get tools limited to groups.</P>
        <H2>Approvals</H2>
        <P>When an agent calls a tool that needs approval, Probaline creates a request for that exact call and holds the call for up to the server’s wait time (45 seconds by default). Approvers see who asked, the tool and what it will send on the <strong>Approvals</strong> page, and approve or refuse with a reason. If nobody decides in time, the agent is told to ask again once it’s approved. An approval runs the call once. Name approvers by email on each server (they can be plain users, who see only the Approvals page), or leave it to your admins; nobody approves their own request. A Slack or Teams webhook can announce new requests (a summary only, never the arguments).</P>
        <H2>APIs inside your network</H2>
        <P>In <strong>MCP servers → Connectors</strong>, add a connector with the hosts it may call. Run it where it can reach them; it connects out over HTTPS, so no inbound firewall change:</P>
        <Code>{`docker run -d --restart unless-stopped \
  -e PROBALINE_URL=https://<gateway> \
  -e PROBALINE_CONNECTOR_TOKEN=<token shown once> \
  probaline/connector:0.1.0`}</Code>
        <P>The connector and collector images are compiled, minimal (no shell, not root) and signed by Probaline’s release workflow with a bill of materials attached. Check one with <C>cosign verify</C> before you run it; the connector’s README has the exact command.</P>
        <P>It never calls cloud metadata addresses or follows redirects, and logs only host, method and status. Answers through a connector are capped at 250 KB.</P>
        <H2>What happens on every call</H2>
        <Table head={['Step', 'What Probaline does']} rows={[
          ['Who', 'A signed-in person (token for this server only, 15 minutes) or an API key with the mcp permission, allowed on this server. Suspended companies and ended licenses are refused'],
          ['Limits', 'The server must be published and not paused; calls a minute per caller'],
          ['Arguments', 'Checked against the tool’s schema; unknown fields refused'],
          ['Secrets', 'A key, token or password in the arguments stops the call, even if prompts are set to redact'],
          ['Company rules', 'Your words, patterns, personal-data and rate-limit rules, on the arguments as sent. A rule set to block stops the call before your API sees it. Approved-model rules don’t apply to tool calls'],
          ['Approval', 'For tools that change data and need it: waits for a person'],
          ['The API call', 'Only to the registered address, with Probaline’s credential and X-Probaline-Identity; no redirects; private addresses only through a connector or a self-hosted gateway'],
          ['The result', 'Personal data removed; text that tries to instruct the agent flagged; cut at the size limit'],
          ['Evidence', 'A case file per call: who, which agent, which tool, the checks, the approval, the API’s answer code; results are kept only as a fingerprint'],
        ]} />
        <P>If the rules can’t be checked, your company’s fail mode decides, as for prompts: <strong>closed</strong> (the default) makes no call; <strong>open</strong> makes it and marks the case file. A stopped call tells the agent <C>Stopped by Probaline</C> with the reason and a request ID you can find in Evidence.</P>
        <H2>For your API’s team: who asked</H2>
        <P>Every call carries <C>X-Probaline-Identity</C>, a token Probaline signs (ES256, five minutes) for your API’s address. It names the person and their groups (or the key), the server, the tool and the request ID. Check it with the key at <C>https://&lt;gateway&gt;/.well-known/jwks.json</C> if your API applies its own per-person rules.</P>
        <P>Tool calls appear in Evidence and on each server’s page, not in the Gateway picture, which shows prompts to AI models.</P>
      </>
    ),
  },
  {
    slug: 'license',
    title: 'Your license',
    summary: 'Adding a license key, what happens when one ends, and the 30 days to renew.',
    body: (
      <>
        <P>Your provider issues a license key for your company and sends it to you. An administrator adds it on the <strong>License</strong> page; it takes effect at once. A key issued for another company is refused.</P>
        <H2>When a license ends</H2>
        <Table head={['When', 'What happens']} rows={[
          ['30 days before it expires', 'Everyone sees a notice on every page, with the date.'],
          ['It expires, is revoked, or is removed', 'Everything keeps working for 30 days. The notice says when AI requests will stop.'],
          ['30 days later', 'AI requests through Probaline stop (apps, IDEs, MCP tools, the browser extension) with the error LICENSE_ENDED. You can still sign in, read your evidence and add a new key.'],
          ['A new key is added', 'Everything works again at once.'],
        ]} />
        <P>Administrators can remove a license from the License page. Without another license, the same 30 days start.</P>
        <H2>Users included</H2>
        <P>The License page shows how many people count against your license: everyone with a dashboard account, plus people who used AI through Probaline in the last 30 days (named on AI requests by your apps, or signed in to an MCP server). Each person counts once. If you go above the number included, the page says so; nothing is cut off.</P>
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
          [<C>POST /mcp/:company/:server</C>, 'An MCP server (Streamable HTTP, JSON-RPC); a signed-in person’s token or a key with the mcp permission'],
          [<C>/oauth/:company/…</C>, 'Sign-in for MCP clients: register, authorize, token, revoke (OAuth 2.1 with PKCE)'],
          [<C>GET /.well-known/jwks.json</C>, 'The key that checks X-Probaline-Identity and Probaline’s sign-in tokens'],
        ]} />
        <H2>Activity and log export (dashboard sign-in)</H2>
        <Table head={['Endpoint', 'Purpose']} rows={[
          [<C>GET /v1/activity</C>, 'Admin activity and sign-ins, newest first; filters category, outcome, from, to; page with next'],
          [<C>GET /v1/log-export</C>, 'Destinations and how each is doing'],
          [<C>POST /v1/log-export/destinations</C>, 'Add one: kind (webhook, splunk_hec, otlp_http), name, url, recordTypes, token, headers'],
          [<C>PATCH · DELETE /v1/log-export/destinations/:id</C>, 'Change, pause or remove'],
          [<C>POST /v1/log-export/destinations/:id/test</C>, 'Send a sample record now'],
          [<C>GET /v1/log-export/dead-letters</C>, 'Batches that weren’t delivered; POST …/:id/retry or DELETE …/:id'],
        ]} />
        <H2>Enforcement (dashboard sign-in, beta)</H2>
        <Table head={['Endpoint', 'Purpose']} rows={[
          [<C>GET /v1/enforcement</C>, 'Feeds, formats and rules, the gateway’s outbound addresses, saved AWS settings'],
          [<C>POST /v1/enforcement/feeds</C>, 'New feed: name, categories. Returns its addresses once'],
          [<C>PATCH · DELETE /v1/enforcement/feeds/:id</C>, 'Rename or change categories; revoke'],
          [<C>POST /v1/enforcement/feeds/:id/rotate</C>, 'New address; the old one stops'],
          [<C>POST /v1/enforcement/feeds/preview</C>, 'Domains and what they’d stop, for categories; uses the latest findings file'],
          [<C>PUT /v1/enforcement/paths/:id</C>, 'Set a path open, previewing or locked'],
          [<C>GET /v1/enforcement/apis</C>, 'APIs behind your MCP servers, with the issuer, keys address and audience their check needs'],
          [<C>POST /v1/enforcement/findings</C>, 'Upload a collector findings file (kept trimmed, 400 days); DELETE …/:id removes one'],
          [<C>PUT /v1/enforcement/aws</C>, 'Save the gateway role, emergency role and targets'],
          [<C>POST /v1/enforcement/aws/generate</C>, 'The SCP, VPC endpoint policy and CloudFormation template, and who they’d refuse'],
          [<C>GET /public/feeds/:tenant/:token/:format</C>, 'The feed, for firewalls: no sign-in, the token is the credential; domains, zscaler, netskope, rpz, hosts'],
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
          ['403', <C>LICENSE_ENDED</C>, 'Your company’s license ended more than 30 days ago; an administrator enters a new key on the License page'],
          ['503', <C>ANALYTICS_UNAVAILABLE</C>, 'Reports can’t be built right now; AI requests are not affected'],
          ['503', <C>SERVER_PAUSED</C>, 'The MCP server is paused by your administrator'],
          ['404', <C>NOT_FOUND</C>, 'No such MCP server, or it isn’t published yet'],
          ['401', <C>INVALID_TOKEN</C>, 'An MCP sign-in token that is expired or for another server; the agent signs in again'],
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
        <P>The repository includes AWS CDK stacks for the network, storage, sign-in, image repositories, services, and the three sites (website, dashboard and docs, each behind CloudFront). The dashboard reaches the gateway on its own address under <C>/api</C>. You’ll need a TLS certificate and a public address for the gateway.</P>
        <Code>{`cd infra
npm install
npx cdk bootstrap
node ../scripts/internal-pki.mjs aws --prefix ai-gov --stage prod   # certificates, once
npx cdk deploy --all --context stage=prod \\
  --context certificateArn=arn:aws:acm:… --context gatewayUrl=https://gateway.example.com`}</Code>
        <P>Your own domains for the sites are optional: <C>websiteDomain</C>, <C>dashboardDomain</C> and <C>docsDomain</C>, with a certificate in us-east-1 (<C>cloudfrontCertificateArn</C>).</P>
        <H2>The first people</H2>
        <P>Make the platform’s first admin once, with the user pool ID the deployment prints:</P>
        <Code>{`node scripts/create-platform-admin.mjs <user-pool-id> you@example.com "First" "Last"`}</Code>
        <P>From then on, creating a company emails its first admin an invitation, and each company’s admins invite their own people from the <strong>Users</strong> page.</P>
        <H2>Services</H2>
        <Table head={['Service', 'Reachable from', 'What it does']} rows={[
          ['Gateway', 'The internet (load balancer)', 'Sign-in, every AI request and its checks, MCP servers, admin settings'],
          ['Policy engine', 'Inside the network only', 'Your rules and compliance packs. It answers only requests the gateway signs'],
          ['Data protection', 'Inside the network only', 'Finds and removes personal data. It answers only requests the gateway signs'],
          ['Analytics', 'Inside the network only', 'Every report built from history: summaries, spend, evidence search, the platform view. It answers only requests the gateway signs, and never sits on the request path'],
        ]} />
        <P>If analytics is down, AI traffic is unaffected: reports say they’re unavailable until it’s back. Services trust each other in two ways. Mutual TLS: each install has its own certificate authority and each service a certificate naming it, so every internal connection is encrypted and only Probaline’s own services can call. And a signed token naming the company: only the gateway holds the private key; the internal services hold only public keys. The AWS deployment makes both. Self-hosting another way, run <C>node scripts/internal-pki.mjs local &lt;dir&gt;</C> for the certificates and <C>node scripts/internal-keys.mjs new gateway</C> for the keys, and set <C>INTERNAL_TLS_*</C>, <C>INTERNAL_SIGNING_KEY</C> (gateway only) and <C>INTERNAL_TRUSTED_KEYS</C>. The services won’t start without them.</P>
        <H2>Protection and alarms</H2>
        <P>The deployment puts AWS WAF in front of the gateway: a per-address rate limit, AWS’s reputation list, and AWS’s rules for headers, paths and queries. Rules that inspect request bodies only count, because prompts are large and full of code; the gateway inspects bodies itself. Turn it off with <C>--context waf=false</C>. Each API key’s calls a minute are enforced across every gateway instance.</P>
        <P>Alarms (gateway errors, policy violation spikes, slow requests, a dependency failing) are emailed to the address you give with <C>--context alarmEmail=…</C>.</P>
        <H2>Evidence retention</H2>
        <P>Each company’s evidence is deleted when its retention period ends: the searchable record expires on its own, and a daily job removes the archive copy. A company admin can place a <strong>legal hold</strong> from Settings, with a reason; while it’s on, nothing is deleted.</P>
        <H2>Database</H2>
        <P>Records are stored in DynamoDB by default, which is what the AWS deployment creates. PostgreSQL 12 or later works too: set <C>STORAGE_BACKEND=postgres</C> and <C>DATABASE_URL</C> on the gateway, policy engine and analytics. Tables are created on first start; no migration step. Files (audit archives) go to S3 or any S3-compatible store (<C>S3_ENDPOINT</C>), or to a directory with <C>OBJECT_STORE=file</C> and <C>OBJECT_STORE_DIR</C>.</P>
        <Table head={['Setting', 'Values']} rows={[
          [<C>STORAGE_BACKEND</C>, <><C>dynamodb</C> (default) or <C>postgres</C></>],
          [<C>DATABASE_URL</C>, <><C>postgres://user:password@host:5432/db</C>; add <C>?sslmode=require</C> for TLS</>],
          [<C>PG_TABLE_PREFIX</C>, 'Optional prefix for table names, e.g. probaline_'],
          [<C>OBJECT_STORE</C>, <><C>s3</C> (default) or <C>file</C></>],
          [<C>LOG_EXPORT_ALLOW_PRIVATE_DESTINATIONS</C>, <><C>true</C> lets log export reach a SIEM inside your network</>],
          [<C>LOG_EXPORT_WORKER</C>, <><C>off</C> stops a gateway from sending log export batches</>],
          [<C>TRUSTED_PROXY_HOPS</C>, <>How many proxies you run in front of the gateway (default <C>0</C>). Behind one load balancer or nginx, set <C>1</C>: only the address it adds to <C>X-Forwarded-For</C> is believed, so callers can't dodge per-address limits by writing their own</>],
          [<C>GATEWAY_EGRESS_IPS</C>, 'Your gateway’s outbound addresses, comma separated, for the “block except from the gateway” rules'],
          [<C>SECRET_STORE</C>, <><C>aws</C> (default, Secrets Manager) or <C>database</C>: provider keys and credentials encrypted in the database</>],
          [<C>SECRETS_ENCRYPTION_KEY</C>, <>With <C>SECRET_STORE=database</C>: 32 random bytes, base64 (<C>openssl rand -base64 32</C>). Keep it apart from your database backups</>],
        ]} />
        <P>With <C>SECRET_STORE=database</C> a PostgreSQL deployment needs no AWS services at all. To change the encryption key, set the new one and keep the old as <C>SECRETS_ENCRYPTION_KEY_OLD</C> until secrets have been saved again. Back up the database and the object store together; the restore runbook (<C>docs/RESTORE-RUNBOOK.md</C>) covers both deployments.</P>
        <H2>From GitHub</H2>
        <P>The <strong>Deploy</strong> workflow runs only when started by hand: Actions → Deploy → Run workflow, then choose the stage, or tear one down. A push never deploys. It creates the image repositories, pushes images tagged with the commit, deploys the stacks, then builds and uploads the three sites with the addresses the stacks report. It signs in to AWS with a role (OIDC) and needs the repository secrets <C>AWS_DEPLOY_ROLE_ARN</C> and <C>AWS_ACCOUNT_ID</C>. On the <C>prod</C> environment set the variables <C>GATEWAY_URL</C> and <C>CERTIFICATE_ARN</C> (and optionally the site domains and <C>CLOUDFRONT_CERTIFICATE_ARN</C>), and add required reviewers.</P>
        <Note>Beta: this deploy passes its checks but hasn’t yet been run against a real AWS account.</Note>
        <H2>Checks on every change</H2>
        <P>The <strong>CI</strong> workflow runs on every push and pull request: all unit tests, every build, the CDK synth and a build of each container image. It never deploys and needs no secrets. The end-to-end suite isn’t in CI yet; run it locally (below).</P>
        <H2>Locally, for evaluation</H2>
        <P>Runs everything on your machine with LocalStack, a stand-in model and sample traffic. Requires Docker and Node.js 20+.</P>
        <Code>{`scripts/dev-local.sh start              # records in DynamoDB (LocalStack)
scripts/dev-local.sh start --postgres   # or in PostgreSQL (Docker, port 5433)
node scripts/seed-traffic.mjs
# dashboard: http://localhost:5174

npm run test:e2e        # the end-to-end suite, against the running stack
scripts/dev-local.sh status`}</Code>
        <P>If the backend services stop answering after a while (the auto-reload helper lives in the system’s temporary folder, which macOS clears), run <C>scripts/dev-local.sh start</C> again; it starts only what isn’t running.</P>
      </>
    ),
  },
];
