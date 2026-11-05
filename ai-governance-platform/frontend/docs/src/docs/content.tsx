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
          [<C>mcp</C>, 'An AI agent using the tools on your MCP servers'],
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
        <P>Other products’ logs that are streamed into one of those buckets (Netskope transaction logs, for example) are read too.</P>
        <H2>On-premises</H2>
        <P>Run the container from <C>collector/deploy/onprem</C>. Point firewalls and proxies at it over syslog (UDP or TCP) and mount DNS server and proxy log folders under <C>/logs</C>.</P>
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
    slug: 'mcp',
    title: 'MCP servers',
    summary: 'Give AI agents your APIs as tools, with every call checked and recorded.',
    body: (
      <>
        <P>An MCP server in Probaline is configuration, not code: create one in a minute, put one or more of your APIs behind it, and agents connect to its address. Agents only ever reach Probaline; your APIs are called by Probaline with its own credential. This is a beta: read tools only, and agents connect with API keys.</P>
        <H2>Create one</H2>
        <ol className="my-3 pl-6 flex flex-col gap-2 text-[16px] leading-relaxed">
          <li>Open <strong>MCP servers</strong> → <strong>Create MCP server</strong>. Give it a name and a line on what it’s for (agents see it).</li>
          <li><strong>Add an API</strong>: its base URL (https), how Probaline signs in to it (bearer token or an API key header; kept in your secret store), and its OpenAPI 3 description (JSON or YAML, pasted or uploaded). Each operation becomes a tool. Tools that read are on; tools that change data are listed but can’t be turned on yet.</li>
          <li>Switch tools off that agents shouldn’t have, and try any tool in the test console. It runs through every check and calls the API for real.</li>
          <li>Set access (every key with the <C>mcp</C> permission, or chosen keys), calls per minute, the largest result, and whether personal data is removed from results (on by default).</li>
          <li><strong>Publish</strong>. Drafts aren’t reachable; a paused server answers “paused”.</li>
        </ol>
        <H2>Connect an agent</H2>
        <P>Create an API key with <strong>Connect AI agents (MCP)</strong> in <strong>More → API keys</strong>. The server page has copy-paste setup; for example, Claude Code:</P>
        <Code>{`claude mcp add --transport http hr-self-service https://<gateway>/mcp/<company>/hr-self-service \
  --header "Authorization: Bearer <your Probaline key>"`}</Code>
        <P>Cursor and VS Code take the same address and header in their MCP settings. Claude Desktop and ChatGPT sign people in rather than using a key; that arrives with sign-in through your identity provider.</P>
        <H2>What happens on every call</H2>
        <Table head={['Step', 'What Probaline does']} rows={[
          ['Arguments', 'Checked against the tool’s schema; unknown fields refused'],
          ['Secrets', 'A key, token or password in the arguments stops the call'],
          ['Company rules', 'Your words, patterns and personal-data rules, as for prompts'],
          ['The API call', 'Only to the registered base URL, with Probaline’s credential; no redirects; private addresses refused unless your self-hosted gateway allows them'],
          ['The result', 'Personal data removed; text that tries to instruct the agent flagged; cut at the size limit'],
          ['Evidence', 'A case file per call: who, which tool, the checks, the API’s answer code; results are kept only as a fingerprint'],
        ]} />
        <P>Tool calls appear in Evidence and on each server’s page, not in the Gateway picture, which shows prompts to AI models.</P>
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
          [<C>POST /mcp/:company/:server</C>, 'An MCP server (Streamable HTTP, JSON-RPC); needs a key with the mcp permission'],
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
          ['503', <C>SERVER_PAUSED</C>, 'The MCP server is paused by your administrator'],
          ['404', <C>NOT_FOUND</C>, 'No such MCP server, or it isn’t published yet'],
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
        <H2>Database</H2>
        <P>Records are stored in DynamoDB by default, which is what the AWS deployment creates. PostgreSQL 12 or later works too: set <C>STORAGE_BACKEND=postgres</C> and <C>DATABASE_URL</C> on the gateway, policy engine and analytics. Tables are created on first start; no migration step. Files (audit archives) go to S3 or any S3-compatible store (<C>S3_ENDPOINT</C>), or to a directory with <C>OBJECT_STORE=file</C> and <C>OBJECT_STORE_DIR</C>.</P>
        <Table head={['Setting', 'Values']} rows={[
          [<C>STORAGE_BACKEND</C>, <><C>dynamodb</C> (default) or <C>postgres</C></>],
          [<C>DATABASE_URL</C>, <><C>postgres://user:password@host:5432/db</C>; add <C>?sslmode=require</C> for TLS</>],
          [<C>PG_TABLE_PREFIX</C>, 'Optional prefix for table names, e.g. probaline_'],
          [<C>OBJECT_STORE</C>, <><C>s3</C> (default) or <C>file</C></>],
        ]} />
        <Note>Provider API keys (for OpenAI and others) are still kept in AWS Secrets Manager, so a PostgreSQL deployment still needs it for now. Storing them encrypted in the database is next.</Note>
        <H2>From GitHub</H2>
        <P>The <strong>Deploy</strong> workflow runs only when started by hand: Actions → Deploy → Run workflow, then choose the stage, or tear one down. A push never deploys. It signs in to AWS with a role (OIDC) and needs these repository secrets: <C>AWS_DEPLOY_ROLE_ARN</C>, <C>AWS_ACCOUNT_ID</C>, <C>WEBSITE_BUCKET_NAME</C> and <C>CLOUDFRONT_DISTRIBUTION_ID</C>. Add required reviewers to the <C>prod</C> environment.</P>
        <Note>The first deploy to a new AWS account will fail: images are pushed before CDK creates their repositories. Until that’s fixed, deploy the infrastructure with CDK from your machine first.</Note>
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
