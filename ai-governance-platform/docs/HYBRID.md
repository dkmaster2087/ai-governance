# Hybrid deployment plan: we manage, you run

Status: plan, not built. Written 2026-10-29.

## The decision

Aegis keeps two deployment modes on the website today: **Hosted by us** and **In your AWS account**. This plan
adds a third, and it is the one most security buyers will want:

- **We run the control plane:** dashboard, rule authoring, compliance packs, licenses, tenant management.
- **The customer runs the data plane:** gateway, policy engine and data protection, in their own AWS account.
- **Prompts and responses never leave their account.** We receive decisions and counts only.

An earlier idea was to split it differently: gateway with the customer, policy engine with us. That is
rejected, for three reasons:

1. The gateway sends the full original prompt to the policy engine (`PolicyEngineClient.evaluate` posts the
   whole `NormalizedAIRequest`). Hosting the engine means hosting every prompt, which defeats the point of
   running in their account.
2. The policy engine has no authentication and trusts the `tenantId` it is sent. It was built to be
   reachable only inside a private network.
3. Every request would take an extra internet round trip, and an outage on our side would block (or, for
   fail-open tenants, stop checking) every customer's traffic at once.

## What lives where

| | Our account (control plane) | Customer account (data plane) |
|---|---|---|
| Dashboard and sign-in (Cognito) | Yes | No |
| Tenants, licenses, plans | Yes | No |
| Rules, compliance packs, settings (fail mode, retention) | Authored here | Cached copy, read-only |
| Model configs and provider keys | No | Yes. Keys stay in their Secrets Manager |
| App API keys | No | Yes |
| Gateway, policy engine, data protection | No | Yes |
| Prompts, responses, masked excerpts, case files | Never | Yes, in their DynamoDB and S3 |
| Decisions and counts (per hour, per app, per rule, per model) | Yes | Source |

Model configs and app API keys stay customer-side because they are secrets or grant access to their AI
spend; the dashboard pages for them link out to the customer's own admin page (see Phase 4).

## How it works

### 1. Rules flow down (signed bundle)

- When an admin saves a rule, model allowlist, framework toggle or tenant setting, the control plane builds a
  **bundle**: one JSON document with every rule, enabled pack and governance setting for that tenant, plus a
  version number and the time it was built.
- The bundle is signed with an AWS KMS asymmetric key (ECDSA P-256). The public key ships in the customer's
  install, so a bundle tampered with in transit or on disk is refused.
- The customer's policy engine polls `GET /v1/bundle` every 60 seconds with its license key and
  `If-None-Match: <version>`. A 304 costs nothing.
- The engine keeps the last good bundle in memory and on disk (S3 in their account). If our side is
  unreachable it keeps enforcing the last bundle indefinitely and raises a "rules are N hours old" warning
  after 24 hours. Our outage never changes their enforcement.
- An expired or revoked license makes `/v1/bundle` return 403. The engine keeps the last bundle and keeps
  enforcing it; stopping enforcement because a license lapsed would make the customer less safe, which is
  the wrong lever. Licensing is enforced commercially and in the dashboard instead.

### 2. Decisions flow up (summaries, no content)

- The gateway already writes an audit record per request. A small job on the customer side (the existing
  reporting agent, reworked) rolls those up into hourly summaries: requests, stopped, cleaned, by app, by
  model, by rule, by provider, with token counts and estimated cost.
- Each summary row carries no prompt text, no response text, no masked excerpts and no end-user IDs. App
  names and rule names are fine; they are the customer's own labels and the dashboard needs them.
- Summaries are posted to `POST /v1/reporting/ingest` with the license key and stored in a new
  `tenant-summaries` table. The dashboard's Overview, Usage and Platform pages read from there.
- Delivery is at-least-once with a summary ID, so a retried post never double counts.

### 3. Evidence stays with them

The dashboard shows case files (masked excerpt, rule, decision) for stopped requests. In hybrid mode those
stay in the customer's account. Two options, in order of preference:

1. **Customer-side evidence viewer (recommended for v1).** The data plane includes a small read-only page
   behind their own SSO or VPN. The hosted dashboard's case-file links open it. Nothing about the content ever
   crosses to us, which is the easiest story for a CISO to sign off.
2. **Cross-account read role (later, opt-in).** The customer grants us an IAM role that can read their
   evidence table, and the hosted dashboard fetches excerpts on demand without storing them. More seamless,
   but the security review is harder because we can read their data.

## Build phases

Each phase ends in something that works and can be shipped on its own.

### Phase 1: the policy engine reads rules through one seam

- Add a `RuleSource` interface to the policy engine with two implementations:
  - `DynamoRuleSource`, today's behaviour (`PolicyRepository.getPoliciesForTenant`).
  - `BundleRuleSource`, which serves rules from the cached bundle.
- Pick by `RULE_SOURCE=dynamo|bundle`. Hosted and in-your-account modes are unchanged.
- Tenant settings the gateway reads today from the tenants table (`tenant-settings.service.ts`: fail mode,
  shadow-AI decisions) also come through the bundle in hybrid mode. The model allowlist is already a rule.
- Done when the existing evaluator tests pass against both sources.

### Phase 2: bundles are built, signed and served

- Control plane: `services/gateway/src/services/bundle.ts` builds the bundle from the policies, tenants and
  frameworks tables; bump the version on every write to those tables.
- KMS signing key in `infra/` (one per environment), public key exported into the data-plane install.
- `GET /v1/bundle` authenticated with the license key. Reuse `checkLicense` from `reporting.routes.ts` with a
  new `bundle:read` scope on licenses.
- Data plane: `BundleRuleSource` polls, verifies the signature, swaps atomically, writes the last good copy.
- Tests: tampered bundle refused, unreachable server keeps the old bundle, 304 path, revoked license.

### Phase 3: summaries are reported and stored

Fix what the reporting agent does today before reusing it:

- It reads the gateway with `Authorization: Bearer test-key`, which only works in dev mode. Give it its own
  scoped API key, or read the audit table directly.
- It sends `costByUser` (end-user IDs). Drop that.
- Its default `saasEndpoint` ends in `/ingest` and then appends `/validate-license` and `/ingest` again.
- `/reporting/ingest` logs the report and discards it; `/reporting/status` returns a stub.

Then:

- Replace the usage/cost/compliance collectors with the hourly rollup described above, read from the local
  audit table.
- Store rows in `tenant-summaries` (tenantId + hour + dimension key), with the summary ID for de-duplication.
- `/reporting/status` returns real last-report time, agent version and bundle version in use.
- Platform page "Needs attention" gains: no report in 2 hours; data plane running an old bundle; agent
  version behind.

### Phase 4: the dashboard runs on summaries

- Add `deploymentMode: 'hybrid'` to tenants (`tenant.routes.ts` enum, `RUNS_LABEL`).
- For hybrid tenants, Overview, Usage and the platform pages read `tenant-summaries` instead of
  `queryAuditLogs`. `platform-usage.ts` gets a second input path with the same output shape, so the pages
  don't change.
- Case-file links go to the customer's evidence viewer URL (stored on the tenant).
- Models and API keys pages show "Managed in your account" with a link to the data plane's admin page.

### Phase 5: packaging

- One CloudFormation/CDK stack for the data plane: gateway, policy engine, data protection, reporting agent,
  evidence viewer, their tables and S3 bucket. Inputs: license key, control-plane URL, public signing key.
- Same container images as the in-your-account mode; the mode is set by environment variables only.
- This is the stack an AWS Marketplace container listing would point at.
- Update the website Deployment page: add "Managed by us, running in your account".

## Rough size

| Phase | Size |
|---|---|
| 1. Rule source seam | 2–3 days |
| 2. Signed bundles | 1 week |
| 3. Reporting rework | 1 week |
| 4. Dashboard on summaries | 1 week |
| 5. Packaging | 1 week, plus testing in a clean AWS account |

About five weeks of solo work. Phases 1 and 3 are worth doing even if hybrid slips: phase 1 makes rule
lookups cacheable, and phase 3 fixes a reporting path that is wrong today.

## Open questions

- **Rule changes take up to a minute to arrive.** Fine for most rules. If a customer needs instant
  "block this model now", add a push (SNS or a long-poll) later.
- **Custom rules with regexes.** The bundle carries them as-is. The evaluator already applies pattern safety
  at check time, so a bad pattern can't hang the data plane; keep that check when evaluating from a bundle.
- **Shadow-AI decisions** (allow/block per tool) are settings and travel in the bundle. Shadow-AI sightings
  are counts and travel up in summaries.
- **Data-plane upgrades.** The customer owns their stack, so we need a supported-versions window (say, the
  last three releases) and a bundle format version the engine checks.
