# Enforcing that AI traffic goes through Probaline: plan

Status: streaming built (apps and proxy mode); lock and verify steps 1 (one catalog) and 3 (share through
Probaline in the collector) built 2026-11-07; steps 2 (AI-domain feed) and 4 (AWS lock) built 2026-11-08, beta;
step 5 (Enforcement page) built 2026-11-08, beta; the rest is planned. Written 2026-10-31; build plan for lock and
verify in both directions (AI going out, agents coming in) added 2026-11-07, see the end.

## Why

A CISO buys Probaline to say: "AI only leaves our company through Probaline, and here is the proof." Today apps and IDEs
can be pointed at Probaline, but nothing stops them going direct, and some can't switch because Probaline doesn't
stream or doesn't speak their provider's format. Monitoring alone is easy to replace; enforcement isn't.

## The model: route, lock, verify

1. **Route:** make switching to Probaline a change of address, never a code change.
2. **Lock:** generate the rules that close every other path, in the tools the customer already runs. Probaline
   doesn't own their network or cloud; it writes the rules and they apply them.
3. **Verify:** the collectors keep measuring, so the customer sees the share of AI traffic going through Probaline
   and every direct path still open.

## 1. Route

| Gap | What to build |
|---|---|
| No streaming | Server-sent events on `/v1/chat/completions` (`stream: true`), with checks on the way in and personal-data masking on the stream out. Streaming pass-through in proxy mode for IDEs. |
| Only the OpenAI format | Anthropic-native `POST /v1/messages`; a Bedrock-compatible endpoint (`/model/{id}/invoke`, `/converse`) so AWS SDK apps switch by endpoint; Azure OpenAI-style paths. |
| Switching takes effort | Setup kits: environment variables per SDK (`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`), a Kubernetes mutating webhook that injects them, and a PAC file for IDEs through the corporate proxy. |

### Streaming design

- Policy checks and prompt masking run before anything is sent, as today. A blocked request never starts a
  stream.
- The answer streams back in the OpenAI `chat.completion.chunk` format and ends with `data: [DONE]`.
- **Masking on the way out:** the gateway holds back a short tail of text (enough for the longest pattern it
  masks) and scans before releasing it, so a phone number split across chunks is still caught. The in-process
  scanner is used for streams; the data-protection service is too slow to call per chunk.
- The audit record is written when the stream ends, with token counts, and records if the client went away
  early.
- Proxy mode streams the provider's bytes straight through after the request check; it already doesn't mask.

## 2. Lock

All locks start in **report-only** mode: the customer sees what would be blocked before anything is.

| Layer | What Probaline generates |
|---|---|
| AWS | An organization-wide policy (SCP) denying `bedrock:InvokeModel*`, `bedrock:Converse*` and `sagemaker:InvokeEndpoint*` to everyone but the Probaline gateway role; VPC endpoint policies to match. |
| Azure | Azure Policy and role assignments limiting Azure OpenAI / AI Foundry data-plane access to the gateway's identity; private endpoints. |
| Google Cloud | Organization policy and VPC Service Controls around Vertex AI, allowing only the gateway's service account. |
| Firewalls and web gateways | A live feed of AI service domains from the collector catalog, in the formats they consume: Palo Alto External Dynamic List, FortiGate external threat feed, Zscaler and Netskope custom URL categories, DNS RPZ zone. The rule: block these except from the gateway's egress addresses. |
| Browsers | The extension blocks unapproved tools and points to approved ones (built). |

Not planned: faking provider certificates to intercept TLS. Web gateways already do this; partner instead.

## 3. Verify

- The collectors add **"share of AI traffic through Probaline"**: gateway requests compared with direct calls they
  still see, per source.
- A list of every server, app or identity still going direct, each with the fix.
- A trend from the first assessment onward, for the CISO's board report.

## Order

| # | Item | Size |
|---|---|---|
| 1 | Streaming (apps and proxy mode): **built** | 1 week |
| 2 | AI domain feed for firewalls, and generated AWS lock policies | 1 week |
| 3 | "Share through Probaline" in collector reports | 3–4 days |
| 4 | Anthropic-native and Bedrock-compatible endpoints | 1–2 weeks |
| 5 | Setup kits (env vars, Kubernetes webhook, PAC) | 1 week |
| 6 | Azure and Google Cloud lock policies | 1 week, with their collectors |

## Risks

- **Breaking apps on day one.** Report-only first; every lock comes with the list of what it would block.
- **Streaming masks only what patterns catch.** The deeper data-protection check can't run per chunk; the
  report and docs say so.
- **Latency.** Holding back a short tail adds a few milliseconds to each chunk; the first token isn't delayed
  beyond the request checks.

---

# Lock and verify: build plan (2026-11-07)

The pitch this makes true: **"AI can only leave our company, and agents can only reach our systems, through
Probaline. Here is the share that does, and every path still open."** It covers both directions now that MCP
servers exist, and it reuses what is built: the collectors, the assessment report, the shadow-AI decisions, the
signed `X-Probaline-Identity` header and the connector.

## Principles

- **Probaline writes the rules; the customer applies them.** We never get write access to their AWS
  organization, firewalls or APIs. Every artifact is a file or a feed URL they review and install.
- **Preview before lock.** No lock has a true report-only mode (an AWS SCP can't "warn"), so the preview comes
  from the collectors: before a rule is applied, Probaline lists who it would block, from the customer's own logs.
- **Verify with the same logs.** Locked or not, the collectors keep measuring. The number is the **share
  through Probaline**, per path, with every identity still going around it and the fix for each.
- **Local-first stays.** Raw logs never leave the customer. The dashboard only sees what an admin uploads
  (a findings file), or later what the collector's `probaline` output sends (counts, never log lines; planned in
  ASSESSMENT.md, not built).

## The paths

| Direction | Path | Lock (generated) | Preview and verify (collector) |
|---|---|---|---|
| Out | Apps in AWS calling Bedrock / SageMaker | Organization SCP: deny `bedrock:InvokeModel*`, `bedrock:Converse*`, `sagemaker:InvokeEndpoint*` except the gateway role; VPC endpoint policy to match | CloudTrail: principals calling those APIs that aren't the gateway role |
| Out | Anything calling model APIs or AI apps over the internet | AI-domain feed for firewalls, web gateways and DNS (formats below), with the rule "block, except from the gateway's egress addresses" | DNS, firewall, proxy, Zscaler/Netskope logs: hosts and people reaching feed domains, other than the gateway |
| Out | People in browsers | Extension blocks unapproved tools (built) | Extension visits (built) plus the logs above |
| In | Agents calling company APIs directly | API accepts only calls carrying a valid `X-Probaline-Identity` (verifier kit) and/or only from the gateway or connector (network rule) | API access logs (ALB, API Gateway, nginx): calls to APIs registered behind Probaline that didn't come through it |
| In | Local MCP servers on laptops (Claude Desktop, Cursor, VS Code, Claude Code) using people's own credentials | Device policy guidance; the server is offered as a Probaline MCP server instead | Endpoint scan of MCP config files via device management (Jamf, Intune, Kandji) |

## What to build

### 1. One AI catalog (3 days) — built
Today there are two lists: the collector's `collector/src/core/catalog.ts` (rich, versioned) and the gateway's
`services/gateway/src/services/ai-tools.ts` (shadow-AI grouping). Move the catalog to `shared/catalog`
(`@ai-governance/catalog`), used by the collector, the gateway and the extension's settings. One version string;
the feed, the report and the Shadow AI page all say which version they used.

### 2. AI-domain feed (4 days) — built, beta
Built as planned. Differences: the gateway's own address isn't removed from the feed (it's never an AI domain);
the exception is in the rule instead. Azure OpenAI and AI Foundry go in as wildcards (`*.openai.azure.com`);
regional Vertex AI hosts and Bedrock/SageMaker can't be written as a domain and are left to the AWS lock (and a
later GCP lock). The Zscaler and Netskope files follow their documented API shapes but haven't been loaded into
either product yet. The preview reads a findings file in the browser; storing uploads is week 3.
- `GET /public/feeds/{tenant}/{feedToken}/{format}`: unauthenticated by design (firewalls fetch feeds
  anonymously); a long random token per feed, revocable, rate-limited, and every fetch logged with the
  firewall's address so the dashboard shows "last fetched by 203.0.113.4, 2 hours ago".
- Contents: catalog domains by category the admin picks (model APIs; chat apps; coding assistants), minus tools
  the company approved on the Shadow AI page, minus the gateway's own address.
- Formats: plain domain list (Palo Alto External Dynamic List, FortiGate external threat feed, Check Point),
  Zscaler custom URL category JSON, Netskope URL list, DNS RPZ zone, and a hosts file. Each with a copy-paste
  rule: block these domains except from the gateway's egress IPs (shown from the deployment's NAT addresses).
- Tests: format golden files; token revocation; approved tools excluded; tenant isolation.

### 3. Share through Probaline, in the collector (4 days) — built
Built as planned, with two choices: a path's headline share comes from the one source that saw most of it among
those that saw the gateway (other sources are listed, never added together), and browsers are not a path (the
extension governs them). `stillDirect` is per path; the fix names apps and people separately.
- New `--gateway role:…,ip:…,host:…` (replaces `--ignore` for the gateway): sightings from those identities
  count as **through Probaline** instead of being dropped. Same log source, same units, so the share is honest.
- Findings gain `paths[]`: per path and source, through vs direct counts, the share, and `stillDirect[]` (who,
  which service, how much, and the fix: "route this app", "covered by the SCP once applied", "add to feed").
- The report gets a first section, "Share through Probaline", and a trend line when earlier findings files sit
  in `reports/` (the collector keeps them already).
- Tests: share maths on fixtures, gateway identities by role, IP and host; trend across three findings files.

### 4. AWS lock generator (3 days) — built, beta
Built with one correction: an SCP can't be deployed by a StackSet, so the template is an
`AWS::Organizations::Policy` for the management account (or the delegated administrator). `Converse` and
`ConverseStream` are covered by `bedrock:InvokeModel*`. Validation is our structural checks; the Access
Analyzer `ValidatePolicy` test isn't written yet.
- Dashboard → **Enforcement** → AWS: enter (or read from the deployment) the gateway role ARN and account IDs;
  download the SCP and VPC endpoint policies as JSON and as a CloudFormation StackSet snippet.
- **Would be blocked:** principals from the uploaded findings that call Bedrock/SageMaker and aren't the gateway.
- Ships with a break-glass statement (a named emergency role) and a note to attach to one OU first.
- Tests: policy JSON validated against the IAM policy grammar (aws-sdk `ValidatePolicy` via Access Analyzer in a
  test that skips without credentials, plus our own structural checks); the gateway role is never denied.

### 5. Enforcement page in the dashboard (5 days) — built, beta
Built as planned. Findings are trimmed on upload (no `sources`, still-direct capped at 50 per path) so one file is
one record, and old files are pruned on upload rather than by a table expiry. "Locked" with no findings dated
after the lock is a warning too, so a lock nobody has verified doesn't look done. The browser path shows no share:
the extension measures it on the Shadow AI page. Incoming paths are listed as Coming.
One page, both directions, a row per path: **Open / Previewing / Locked**, the share through Probaline, the
would-be-blocked list, and the artifact to install. "Locked" is what the admin says; the share and the
still-direct list are what the logs show, side by side, so a lock that wasn't applied is visible.
- Upload a findings file (JSON) from a collector report; stored per tenant, kept 400 days for the trend.
- Admin activity records every artifact generated, feed created or revoked, and findings uploaded.
- Copy in the house style; whole page marked Beta until a customer has applied a lock.

### 6. Incoming lock kit (4 days)
For each API behind a Probaline MCP server, a **Lock this API** panel:
- **Verifier snippets** that check `X-Probaline-Identity` against `/.well-known/jwks.json` (audience = the API's
  base URL, five-minute tokens): Node (Express/Fastify middleware), Python (FastAPI/Flask), Go, Java (Spring
  filter), and an **AWS API Gateway Lambda authorizer**. Each has a `report-only` switch that logs unsigned
  calls instead of refusing them, which is the incoming preview.
- **Network option:** the gateway's egress IPs (or "only from the connector's host") for a security group, WAF
  IP set or nginx allow list.
- The verifier libraries are small, published from this repo (`packages/verify-identity-*`), with tests against
  tokens the gateway's test keys sign.

### 7. Laptop MCP discovery (4 days)
- A read-only script for device management (`collector/endpoint/mcp-scan.sh` and `.ps1`): reads the MCP config
  files of Claude Desktop, Claude Code, Cursor, VS Code and Windsurf; outputs server name, transport, command
  or URL host, and which config. **Never** environment values, headers or arguments that look like secrets.
- New collector source `endpoint_mcp`: report section "MCP servers on laptops" (how many people, which
  servers, local programs vs remote URLs, which reach company hosts), with the recommendation to offer each as
  a Probaline MCP server.
- Tests: fixture configs for each client; secret-looking values never appear in output.

### 8. Incoming verify (3 days)
- Probaline exports the list of APIs registered behind MCP servers (hosts and paths, no credentials) as a file
  the collector reads.
- New collector parsers for ALB access logs, API Gateway access logs and nginx/Envoy access logs: calls to
  those hosts, split into through Probaline (gateway egress, connector host, or a valid identity header when
  the log records it) and direct, with the caller and the user agent (agent clients named where recognizable).

## Order and what each step lets us say

| Week | Build | Can say |
|---|---|---|
| 1 | 1 One catalog · 3 Share through Probaline | "Your first report shows the share through Probaline and every path still open." |
| 2 | 2 Domain feed · 4 AWS lock | "Apply these and only the gateway reaches AI, after you've seen who it would block." |
| 3 | 5 Enforcement page | "One page shows each path, locked or not, and the logs prove it." |
| 4 | 6 Incoming lock kit · 7 Laptop MCP discovery | "Agents reach your APIs only through Probaline, and we find the MCP servers on laptops." |
| 5 | 8 Incoming verify; buffer | "And the API logs prove that too." |

Weeks 1–2 are the first sellable slice: an assessment that ends in generated lock rules.

## Done means
Unit tests for every generator and parser; e2e: a feed fetched by token and revoked, findings uploaded and the
Enforcement page reflecting them, a verifier snippet refusing an unsigned call and accepting a signed one from
the local gateway; dashboard checked at desktop and phone width; docs site pages "Locking AI traffic" and
"Locking your APIs"; sales site's Enforce phase updated with what is Available and Beta.

## Risks and open questions
- **Egress addresses.** The firewall rule needs fixed gateway egress IPs. AWS deploys have a NAT gateway (one
  today, two in production); self-hosted customers must tell us theirs. Hosted SaaS needs published IPs.
- **Feed tokens in URLs** can leak through firewall configs; mitigated by revocation, fetch logging and the feed
  containing only public domain names.
- **SCP mistakes lock people out of Bedrock.** Break-glass role, OU-first rollout, and the would-be-blocked list.
- **Verifier adoption** depends on each API team; the network option needs none and goes first where possible.
- **Laptop scanning** needs device-management access the security team usually has, but the script must be
  reviewed by them; keep it short, read-only, and open source in the repo.
- **Open:** whether hosted customers get the feed from our domain or a customer-specific one; whether the
  Enforcement page should accept findings automatically from the paid `probaline` collector output in v1.

