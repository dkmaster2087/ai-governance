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
| Compliance | SOC 2, HIPAA, EU AI Act on/off, controls in place, which need a manual review |
| Users | Roles, and how to add people in Cognito (local demo accounts in development) |

Spend, License and Settings use the same design.

### Platform admin (running Probaline for many customers)

| Page | What it shows |
|---|---|
| Platform | Requests across tenants, what needs attention (suspended, open fail mode, licenses expiring or missing, no traffic) |
| Tenants | Every tenant with 30-day traffic; add one, then the Cognito command for its admin |
| Tenant | Traffic, setup (fail mode, rules, models, frameworks), licenses; edit, suspend, reactivate |
| Licenses | Issue and revoke license keys |
| Usage | Requests, stops and estimated spend per tenant and model, 7/30/90 days |
| Health | The gateway's own check of its database, policy engine and data protection |

## Compliance packs

SOC 2, HIPAA and the EU AI Act. Enabling a pack creates a linked policy. Pack controls the gateway doesn't
enforce (for example "log every request") are listed separately on the Rules page.

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

## Deployment

- **Hosted** and **in the customer's AWS account** (same software, AWS CDK).
- **On-premises / Kubernetes / air-gapped:** planned.

## MCP servers (beta)

From **MCP servers** in the dashboard, admins create as many MCP servers as they need, each in front of one or
more company APIs added from their OpenAPI descriptions, with its own address, tools and list of which keys may
connect. Agents (Claude Code, Cursor, VS Code, a company's own) connect with an API key that has the `mcp`
permission. Read tools only for now. Every call: arguments checked against the schema, the secrets check and
company rules; the API called with Probaline's own credential; personal data removed from the result;
instruction-like text flagged; a case file in Evidence. A test console tries tools before publishing.

Planned: people signing in through the company's identity provider, write tools with approval, versions, and a
connector for on-premises APIs. Plan: [MCP.md](MCP.md).
