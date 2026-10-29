# Aegis — what it does

Aegis is a gateway between a company and AI providers. Every request passes the same checks, in the same
order, and every decision is recorded. This document describes what exists today; planned work is marked.

## The checks

| # | Check | What it does | Status |
|---|---|---|---|
| 1 | Policy rules | Stops prompts matching the company's rules: words or phrases, patterns, approved models, personal-data types | Available |
| 2 | Secrets | Stops API keys, tokens and private keys in prompts | Planned (shown as "not active yet") |
| 3 | Personal data | Removes emails, phone numbers, SSNs and card numbers in place, then sends the prompt | Available |

If the policy or personal-data check can't run, the request is **blocked** by default. A company can choose
to let requests through instead; those are flagged in their evidence record.

## How traffic arrives

- **Apps:** OpenAI-compatible `POST /v1/chat/completions` with an Aegis API key. Providers: Amazon Bedrock and
  OpenAI-compatible APIs. Streaming responses are not supported yet.
- **IDEs (beta):** the corporate proxy sends provider calls to `/v1/proxy/{openai|anthropic|cohere|mistral}/…`
  with an `X-Aegis-Key` header; the developer's own provider key passes through untouched.
- **Browsers:** the Shadow AI Guard extension, deployed through Chrome policy, records and blocks AI tools used
  outside the gateway.

## Dashboard

| Page | Shows |
|---|---|
| Gateway | Traffic as a pipeline (apps → checks → providers), decisions waiting, a plain-English feed |
| Stopped | Stopped requests grouped by rule, with apps, people, per-day counts and the masked trigger |
| Shadow AI | AI tools used outside the gateway, by tool; Block / Allow / keep watching per tool |
| Rules | Rules as sentences grouped by check, with weekly results; add, edit, switch off; fail mode |
| Evidence | Every decision, searchable; a case file per request with a downloadable export |
| API keys | Keys with scoped permissions and optional expiry; create, replace, revoke |

Other pages (Models & keys, Spend, Compliance, Users, License, Settings) and the platform-admin views still use
the previous visual style.

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

API key permissions: `chat`, `models`, `shadow_ai:ingest`. On-prem license keys (`reporting:ingest`) are issued
by platform admins only.

## Deployment

- **Hosted** and **in the customer's AWS account** (same software, AWS CDK).
- **On-premises / Kubernetes / air-gapped:** planned.
