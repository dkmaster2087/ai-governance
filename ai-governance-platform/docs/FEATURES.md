# Probaline — what it does

Probaline is a gateway between a company and AI providers. Every request passes the same checks, in the same
order, and every decision is recorded. This document describes what exists today; planned work is marked.

## The checks

| # | Check | What it does | Status |
|---|---|---|---|
| 1 | Policy rules | Stops prompts matching the company's rules: words or phrases, patterns, approved models, personal-data types | Available |
| 2 | Secrets | Stops (default) or removes API keys, tokens, private keys, connection strings and passwords in prompts; the company can also turn it off | Available |
| 3 | Personal data | Removes emails, phone numbers, SSNs and card numbers in place, then sends the prompt | Available |

The secrets check runs inside the gateway, so it can't be unavailable. It covers about 20 credential formats
(AWS, Azure, Google, OpenAI, Anthropic, GitHub, GitLab, Slack, Stripe and others), private key blocks, JWTs,
connection strings with a password and `password = …` lines, and ignores obvious placeholders. A stopped
request returns `403 SECRET_DETECTED`; the secret's value is never stored anywhere, and excerpts kept by
other rules are scrubbed of secrets too.

If the policy or personal-data check can't run, the request is **blocked** by default. A company can choose
to let requests through instead; those are flagged in their evidence record.

## How traffic arrives

- **Apps:** OpenAI-compatible `POST /v1/chat/completions` with a Probaline API key. Providers: Amazon Bedrock and
  OpenAI-compatible APIs. `stream: true` returns OpenAI-format server-sent events; personal data in the answer is
  masked as it streams, and the case file is written when the stream ends (also if the app disconnects).
- **IDEs (beta):** the corporate proxy sends provider calls to `/v1/proxy/{openai|anthropic|cohere|mistral}/…`
  with an `X-Probaline-Key` header; the developer's own provider key passes through untouched.
- **Browsers (beta):** the Shadow AI Guard extension, deployed through Chrome policy (`gatewayUrl`, `apiKey`,
  optional `identifyUsers`), records which AI tools are opened (domain only, once per tool per ten minutes),
  blocks the ones the tenant blocked, and shows a block page with the tenant's message and approved tools.

## Dashboard

| Page | Shows |
|---|---|
| Gateway | Traffic as a pipeline (apps → checks → providers), decisions waiting, a plain-English feed |
| Stopped | Stopped requests grouped by rule, with apps, people, per-day counts and the masked trigger |
| Shadow AI | AI tools used outside the gateway, by tool; Block / Allow / keep watching per tool; the block page's message and approved-tool links |
| Rules | Rules as sentences grouped by check, with weekly results; add, edit, switch off; fail mode |
| Evidence | Every decision, searchable; a case file per request with a downloadable export |
| API keys | Keys with scoped permissions and optional expiry; create, replace, revoke |

| Models & keys | Models apps can reach (Amazon Bedrock or OpenAI), provider keys, prices for Spend; test a model |
| Compliance | SOC 2, HIPAA, EU AI Act on/off; every control as enforced by a rule, built into Probaline, needing your action, or not covered yet |
| Users | Roles, and how to add people in Cognito (local demo accounts in development) |

Spend, License and Settings use the same design.

### Platform admin (running Probaline for many customers)

| Page | What it shows |
|---|---|
| Platform | Requests across tenants, what needs attention (suspended, open fail mode, licenses expiring or missing, no traffic) |
| Tenants | Every tenant with 30-day traffic; add one, then the Cognito command for its admin |
| Tenant | Traffic, setup (fail mode, rules, models, frameworks), licenses; edit, suspend, reactivate |
| Licenses | Issue license keys, and revoke them with 30 days to renew or at once |
| Usage | Requests, stops and estimated spend per tenant and model, 7/30/90 days |
| Health | The gateway's own check of its database, policy engine and data protection |

## Compliance packs

SOC 2, HIPAA and the EU AI Act. Turning one on creates its rules in a linked policy. Every control says how it
is met, worked out live from what is switched on, never from stored counts:

| State | Meaning | Examples |
|---|---|---|
| Enforced by a rule | A rule checks every request, and it and its policy are on | HIPAA health-data blocking, SOC 2 approved models, rate limits |
| Built into Probaline | Done for every company | Case file for every request, sign-in and keys, HTTPS to providers, evidence kept long enough |
| Needs your action | Something only the company can do | List the models covered by your BAA, raise evidence retention to 6 years (HIPAA), human oversight procedures |
| Not covered yet | Probaline doesn't do it | Clinical accuracy of answers, marking AI-generated content (Art. 50), alerts for unusual usage |

The rules:

- **HIPAA:** stops protected health information: health details (diagnoses, ICD-10 codes, medications and
  doses, lab results, conditions) together with an identifier (record number, labelled date of birth, SSN,
  member or policy ID, email, phone, a patient's name). Health details alone, and ordinary names, places and
  dates, are let through. Only models listed as covered by a BAA may be used (the list starts empty).
- **SOC 2:** only models added on the Models page; personal data flagged (and removed by data protection);
  per-company rate limits (600 a minute, 100,000 a day by default, counted across all instances).
- **EU AI Act:** personal data flagged; credentials and requests for attack help flagged (not stopped); rate limits.
- Rules run in priority order across all of a company's policies. Model rules never apply to MCP tool calls.
- Companies that turned a framework on before these rules existed see **Update rules** on the Compliance page;
  it keeps lists they filled in (allowed models, keywords) and their own rules, and removes rules nothing checked.

## What is recorded

- For every request: who, which app, which model, the outcome, token counts, timing, estimated cost, and
  SHA-256 fingerprints of the prompt and response.
- For stopped requests only: about 60 characters either side of the trigger, with personal data masked; a
  personal-data trigger is stored only as its type (for example `[SSN]`).
- The text of delivered prompts is never stored.

## Access

| Role | Can |
|---|---|
| Admin | Everything for their company |
| Auditor | Read Gateway, Stopped and Evidence |
| User | Use AI through approved apps; no dashboard |
| Platform admin | Manage tenants and licenses across companies |

API key permissions: `chat`, `models`, `shadow_ai:ingest`, `mcp`. On-prem license keys (`reporting:ingest`) are issued
by platform admins only.

## Licenses

- The platform admin issues a license key for one company and sends it to them. It counts once one of the
  company's admins enters it on their **License** page; a key issued for another company is refused. Admins
  can also remove a license from their company.
- Everyone at the company sees a banner on every page when something needs doing: 30 days before the license
  expires, and once it has ended (expired, revoked or removed), with the date AI requests will stop.
- After a license ends, everything keeps working for 30 days. Then AI requests stop: apps, IDE proxy traffic,
  MCP tool calls and the browser extension get `403 LICENSE_ENDED` with a plain message. People can still sign
  in to the dashboard, enter a new key (which takes effect at once) and read their evidence.
- The platform admin can revoke with the 30 days, or stop at once. Companies that never entered a license get
  the same 30 days: new companies from creation, existing ones from when licensing started being enforced.
- Settings: `LICENSE_GRACE_DAYS` and `LICENSE_WARN_DAYS` (both 30). The platform's own tenant needs no license.

## Deployment

- **Hosted** and **in the customer's AWS account** (same software, AWS CDK).
- **On-premises / Kubernetes / air-gapped:** planned.

## MCP servers (beta)

From **MCP servers** in the dashboard, admins create as many MCP servers as they need, each in front of one or
more company APIs added from their OpenAPI descriptions, with its own address, tools, access and approvals.

- **Who connects.** People sign in with their company account (any OpenID Connect provider: Entra ID, Okta,
  Google…) from Claude, ChatGPT, Cursor or VS Code; a consent page asks them to allow the agent. Each server
  lets nobody, everyone or chosen groups in, and tools can be limited to groups. The company's own agents use
  an API key with the `mcp` permission.
- **Reads and writes.** Read tools are on when an API is added. Write tools are switched on one by one, and each
  needs a person's approval (on the **Approvals** page, optionally announced in Slack or Teams) or runs
  straight away. An approval is for one exact call and is used once; nobody approves their own request.
- **Every call:** arguments checked against the schema, the secrets check and company rules; approval where
  needed; the API called with Probaline's own credential plus a signed statement of who asked; personal data
  removed from the result; instruction-like text flagged; a case file in Evidence.
- **Draft and versions.** Changes are made as a draft and published as a numbered version; any version can be
  restored. A test console tries tools before publishing.
- **APIs inside the network.** A connector in the company's network reaches them over outbound HTTPS only.

Plan and limits: [MCP.md](MCP.md).
