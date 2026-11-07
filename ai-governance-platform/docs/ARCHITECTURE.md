# Probaline — architecture

## Request path (apps)

```
App ──POST /v1/chat/completions──▶ Gateway (:3000)
   Authorization: Bearer <Probaline key>   │
                                       ├─ 1. Auth: key → tenant (from the key record, never from headers),
                                       │       scope check, tenant not suspended
                                       ├─ 2. Policy engine (:3001) evaluates rules on the ORIGINAL prompt
                                       │       └─ match with action "block" → 403 POLICY_VIOLATION + audit
                                       ├─ 3. Secrets (in process): tenant setting secretsAction
                                       │       block (default) → 403 SECRET_DETECTED + audit
                                       │       redact → each secret replaced by [REDACTED <type>]; off → skipped
                                       ├─ 4. Data protection (:3002) removes personal data
                                       ├─ 5. Provider: Bedrock (IAM role) or OpenAI-compatible
                                       │       (provider key read from Secrets Manager)
                                       ├─ 6. Response scanned for personal data (in process + service)
                                       └─ 7. Audit record (queryable) + archive copy (S3 with KMS, or a directory)
```

- Policy runs **before** masking so rules about personal data can see it; only the masked prompt leaves.
- The secrets check never sends the prompt anywhere and has no fail mode. A secret's value is never written to
  the audit record; evidence excerpts from any rule are passed through the same detector before they're saved.
  The policy engine (step 2) does receive the original prompt, inside the VPC, as it did before.
- If step 2 or 4 can't run, the tenant's fail mode decides: `closed` (default) returns
  `503 GOVERNANCE_UNAVAILABLE`; `open` continues and marks the audit record `governanceDegraded`.
- Stopped requests keep a short masked excerpt of the trigger in the audit record; delivered prompts are kept
  only as SHA-256 fingerprints.

## Request path (IDEs, proxy mode)

```
IDE ──▶ corporate proxy ──▶ Gateway /v1/proxy/:provider/*  ──▶ provider
         adds X-Probaline-Key      checks policy and secrets on       (developer's own key, untouched)
                               extracted text; in redact mode the
                               body's strings are redacted first
```

The gateway extracts text from OpenAI and Anthropic formats, including content-block arrays and the Anthropic
`system` field, then forwards the original request.

## Request path (AI agents, MCP)

Agents connect to `POST /mcp/<tenant>/<server>` (MCP over streamable HTTP, JSON-RPC). Every step runs in this
order, and a call that fails a step never reaches the company's API.

```
Agent ──POST /mcp/:tenant/:server──▶ Gateway (:3000)
                                       ├─ 1. Origin: browsers on other sites refused (403)
                                       ├─ 2. Who
                                       │     API key: mcp permission, key belongs to this tenant, tenant not
                                       │       suspended, license not ended, the key's own calls a minute
                                       │     person: Probaline sign-in token for this server only (15 minutes),
                                       │       tenant not suspended, license not ended; else 401 + where to sign in
                                       ├─ 3. Server: published (drafts are 404), not paused (503)
                                       ├─ 4. Access list: this key, or this person or one of their groups (403)
                                       ├─ 5. Calls a minute for this caller on this server (429)
                                       ├─ 6. tools/call: only tools switched on and, for people, allowed to their groups
                                       ├─ 7. Arguments checked against the tool's schema
                                       ├─ 8. Secrets in the arguments stop the call (unless the tenant turned secrets off)
                                       ├─ 9. Policy engine (:3001, mutual TLS + signed token) evaluates the tenant's rules
                                       │       on the arguments: words, patterns, personal data, rate limits
                                       │       └─ a rule with action "block" stops the call
                                       ├─ 10. Writes that need approval wait for a named approver
                                       ├─ 11. The API: registered address only, Probaline's credential,
                                       │       X-Probaline-Identity (signed, 5 minutes); no redirects; private
                                       │       addresses only through a connector or a self-hosted gateway
                                       ├─ 12. Result: data protection (:3002) removes personal data (unless the server
                                       │       is set to return it); instruction-like text flagged; size cap
                                       └─ 13. Case file for every call, stopped or delivered
```

- Rules see the arguments as sent; they're never rewritten. A stopped call says `Stopped by Probaline: <reason>`
  with a request ID, and its case file keeps a masked excerpt.
- Model rules (approved models) don't apply to tool calls; tool calls aren't model traffic.
- If the policy engine can't answer, the tenant's fail mode decides: `closed` (default) makes no call;
  `open` makes it and marks the case file `governanceDegraded`. If data protection can't answer, the gateway's
  own scanner masks the result instead.
- Tested in `services/gateway/src/__tests__/mcp.test.ts` and `mcp-phase2.test.ts`, and end to end in
  `tests/e2e/request-path.test.mjs` (a word rule and a personal-data rule stop calls before the API; a suspended
  company's agent is refused).

## Dashboard and admin APIs

The dashboard talks only to the gateway. Users sign in with Cognito (ID token, `custom:tenantId`,
`custom:role`); the gateway verifies the token and checks role per route. Platform admins may act on other
tenants via `X-Tenant-Id`; everyone else is limited to their own.

| Gateway endpoint | For |
|---|---|
| `GET /v1/gateway/summary`, `GET /v1/gateway/stopped` | Gateway and Stopped pages (built by analytics) |
| `GET/POST/PATCH/DELETE /v1/rules…`, `GET/PUT /v1/gateway/settings` | Rules page (forwards to the policy engine with the caller's tenant) |
| `GET /v1/shadow-ai/summary`, `GET/PUT /v1/shadow-ai/policy` | Shadow AI page |
| `GET /v1/shadow-ai/config`, `POST /v1/shadow-ai/events` | Browser extension (`shadow_ai:ingest` key; tenant from the key) |
| `GET /v1/evidence…` | Evidence page and exports (built by analytics) |
| `GET /v1/cost/…` | Spend (built by analytics) |
| `GET/POST /v1/api-keys…` | API keys page |
| `GET /v1/activity` | Activity page (admin changes and sign-ins, newest first) |
| `GET/POST/PATCH/DELETE /v1/log-export…` | Log export page: destinations, test, new signing secret, undelivered batches |
| `GET /v1/platform/usage`, `/v1/tenants…`, `/health/deep` | Platform-admin pages (platform admins only, except health) |

## Reports (analytics service)

Every report built from history runs in the analytics service (:3003), not in the gateway, so a heavy report
can never slow a prompt down, and the two scale separately: the Gateway and Stopped summaries, spend, Evidence
search and case files, the Shadow AI summary, what each rule did, MCP calls per server, and the platform view.

```
Dashboard ──▶ Gateway: who is this, may they see it? ──▶ Analytics (internal only)
                 signs X-Probaline-Internal                  checks the signature, takes the
                 (HS256, 60 s: company, user, role)          company from the token, reads history
```

- Analytics answers nothing without a token the gateway signed, over mutual TLS (see "Trust between
  services"). The company always comes from the token, never from the address, so a request for one company
  can't read another's data even from inside the VPC.
- Analytics only reads (audit records, tenants, shadow AI events); it has no write access.
- Off the request path: if analytics is down, reports answer `503 ANALYTICS_UNAVAILABLE`, the Rules and MCP
  pages load without their counts, the Health page shows it under **Reports**, and prompts are unaffected.
- Next, for very large histories: running totals kept as requests happen, and long-range reports read from
  the S3 archive through Athena.

## Storage

Every service reads and writes through `shared/storage` (`@ai-governance/storage`). `STORAGE_BACKEND` picks
DynamoDB (default, and what the AWS deployment uses), PostgreSQL, or memory (unit tests). Files go to S3 (or an
S3-compatible store) or a directory, chosen by `OBJECT_STORE`. Design and limits: [STORAGE.md](STORAGE.md).

| Data | Collection (DynamoDB table / PostgreSQL table) | Lookups |
|---|---|---|
| Tenants, settings (fail mode, secrets, shadow-AI decisions) | `tenants` | by tenant |
| Policies and rules | `policies` | by tenant |
| Compliance packs | `compliance` | by tenant |
| API keys (SHA-256 hashes only) | `api-keys` / `api_keys` | by tenant; `keyHash-index` |
| Model configs (secret ARN + hint only) | `models`; provider keys in Secrets Manager | by tenant |
| Alert rules | `alerts` | by tenant |
| Audit records (expire) | `audit-logs` / `audit_logs`, + archive file | `tenantId-timestamp-index` |
| Shadow-AI events (30-day expiry) | `shadow-ai` / `shadow_ai` | by tenant, newest first |
| Metrics (expire) | `metrics` | by tenant and period prefix |
| Admin activity and sign-ins (400-day expiry), + archive file | `activity` | by tenant, sorted by `<time>#<id>` |
| Log destinations (secrets in Secrets Manager) and undelivered batches (30-day expiry) | `log-export` / `log_export` | by tenant; `dest#…` and `dead#…` |

## Logs

| Kind | Where | Kept | Who sees it |
|---|---|---|---|
| Service logs (JSON lines from `createLogger`) | stdout → CloudWatch log group `/ecs/<prefix>-<service>-<stage>` | 1 month | the operator |
| Decisions | `audit_logs` + one file per record in the audit bucket | the tenant's retention setting* | tenant: Evidence, log export |
| Admin activity and sign-ins | `activity` + one file per record in the audit bucket (`activity/<tenant>/<date>/`) | 400 days (`ACTIVITY_RETENTION_DAYS`) | tenant: Activity, log export |
| Dashboard password checks | Cognito → CloudTrail | per the account's trail | the operator |

\* Not yet enforced on stored records; see Known gaps.

**Admin activity** is recorded by one gateway hook (`src/activity/admin-activity.ts`) on every POST, PUT,
PATCH or DELETE by a signed-in user, mapped from the route to an action name (`rule.created`,
`api_key.revoked`…; routes not in the map are recorded as `<area>.changed`). It stores route IDs and the
created record's ID, never bodies. Successful changes, refusals (401/403) and server errors are recorded; a
rejected form (400/404/409) changed nothing and isn't. A platform admin's change to a tenant is recorded on
that tenant. **Sign-ins** are recorded by the auth middleware (a dashboard session once per Cognito
`auth_time`; refused revoked, expired or wrong-tenant keys, at most once a minute per key) and by the MCP
sign-in routes. Unknown API keys can't be tied to a tenant, so they are only a service log line.

**Log export** (`src/log-export/`): a sender in each gateway wakes every 10 seconds, takes a lease on each
destination, reads decisions (`tenantId-timestamp-index`) and activity newer than the destination's cursor and
at least 30 seconds old, sends a batch, and moves the cursor. Nothing extra is written on the request path.
Delivery is at least once (records carry stable IDs to de-duplicate). Failures are retried at 30 s, 1, 2 and
4 minutes, then the batch becomes a dead letter and the cursor moves on. Outbound calls use the same guard as
MCP backends (https only, no private or metadata addresses, no redirects, 10-second timeout).
`LOG_EXPORT_WORKER=off` stops a gateway from sending.

### Sending service logs to a SIEM (operator, self-hosted)

The tenant log export covers the records a company owns. For the services' own logs in a self-hosted or
in-account deployment, use AWS directly:

- **CloudWatch subscription filter → Amazon Data Firehose** on each `/ecs/<prefix>-<service>-<stage>` log
  group. Firehose delivers to Splunk (HEC), Datadog, Elastic, Sumo Logic, New Relic, an HTTP endpoint or S3.
  One filter per log group (pattern `""` for everything, or `{ $.level = "error" }`).
- **Microsoft Sentinel:** its AWS S3 connector reads CloudTrail and logs that Firehose writes to S3.
- **Cognito sign-ins** (including failed passwords) are CloudTrail events from `cognito-idp.amazonaws.com`;
  send the trail the same way.
- **Off AWS:** run the services under any log driver; their stdout is one JSON object per line, ready for an
  OpenTelemetry Collector (`filelog` receiver) or Fluent Bit.

## Websites

- `frontend/website` (port 5173): the public sales site. It tells the inspect → protect → enforce story and
  labels every piece Available, Beta or Coming; it has no technical docs.
- `frontend/docs` (port 5175): setup and reference docs (gateway, IDEs, extension, collectors, API). Not
  linked from the sales site and marked `noindex`.

## Testing

- **Unit tests** in each workspace (including `collector`): `npm test` from the root, plus the browser
  extension's `node --test extensions/shadow-ai-guard/tests/lib.test.mjs`.
- **Collector on sample data:** `node collector/scripts/sample-aws-logs.mjs <dir>` writes three weeks of
  made-up AWS logs; `collector/dist/cli.js collect` and `report` turn them into an assessment report.
- **End-to-end request path** ([tests/e2e/request-path.test.mjs](../tests/e2e/request-path.test.mjs)): real
  requests through the gateway, policy engine, data protection and a mock model, checking what the app got
  back, what the model received and what the case file says. Covers clean prompts, personal-data removal in
  prompts and replies, blocked-word, approved-model and personal-data rules, rule changes taking effect,
  tenant separation, missing/fake/revoked keys, suspended tenants, proxy mode, and fail closed/open with the
  checks down. Also [tests/e2e/log-export.test.mjs](../tests/e2e/log-export.test.mjs): admin changes and a
  revoked key show on Activity, and a local collector receives signed webhook batches, Splunk HEC events and
  OTLP logs; a failing destination is retried, set aside, and sent again. Start the local stack (`scripts/dev-local.sh start`), then `npm run test:e2e`. Not in CI yet
  (needs LocalStack there). Locally, personal data is found by patterns only; Amazon Comprehend runs only in AWS.

## Deployment modes

| | Cloud | Hybrid | Self-hosted |
|---|---|---|---|
| Request path (gateway, policy engine, data protection) | Our AWS | Customer | Customer |
| Dashboard, rules, licenses | Our AWS | Our AWS | Customer |
| Status | Available | Planned: [HYBRID.md](HYBRID.md) | Available in the customer's AWS account; on-premises and Kubernetes planned |

The tenant field `deploymentMode` holds `saas` (Cloud) or `onprem` (Self-hosted in their AWS account).

**Collectors** for AI usage assessments and continuous shadow-AI discovery are a separate component, not part
of any of these installs. The same collector runs alongside all three, or on its own for an assessment with
nothing else installed. Plan: [ASSESSMENT.md](ASSESSMENT.md). Built in [collector/](../collector/README.md): AWS,
on-premises, and as beta Zscaler, Netskope, Azure, Google Cloud, Microsoft 365, Google Workspace, Okta, Entra and
other identity providers' sign-in exports.

**MCP servers on demand** (phases 1 and 2 built, beta): admins create MCP servers from the dashboard, each in front
of one or more company APIs, with its own address, tools, access and approvals. People sign in through the
company's identity provider: the gateway is an OAuth authorization server per company (`/oauth/<tenant>`) and an
OIDC client of the company's provider. Writes wait for approval; every call carries a signed identity token
(keys at `/.well-known/jwks.json`); arguments and results are checked like prompts, and every tool call has a
case file. APIs inside a company network are reached through the connector (`connector/`), which polls the
gateway over HTTPS; queued calls are kept, encrypted, in the shared database so any gateway instance can hand
them out. Plan: [MCP.md](MCP.md).

## Deployment (AWS)

```
Browser ──▶ CloudFront: website / dashboard / docs (private S3)
              └─ /api/* ──▶ Gateway (public, HTTPS) ──▶ internal load balancer: policy engine, data protection,
                                                       analytics (signed internal token)
Images: ECR repositories in their own stack, tagged with the commit; a deploy rolls the services to that tag.
People: Cognito. Company admins invite their people from the dashboard (the gateway creates the sign-in and
Cognito emails the invitation); the platform's first admin is made once with scripts/create-platform-admin.mjs.
```

Browsers reach the gateway on the site's own address, so the gateway allows no other website by default
(`ALLOWED_ORIGINS` empty), only the browser extension.

## On-prem reporting (beta)

An on-prem install can run the reporting agent (`services/reporting-agent`). Every few minutes it reads the
last 24 hours' usage and cost from its own analytics (a signed internal token that can read only that summary)
and framework status from its policy engine, and sends them with its license key to the platform's
`/v1/reporting/ingest`. The platform keeps only the parts the company allows on its License page, for 13
months; audit records never leave the install. If a part can't be read, nothing is sent rather than zeros. The
agent's own API needs a signed internal token from an admin.

## Security and retention

- **Internal services** (policy engine, data protection, analytics): see "Trust between services" below.
- **Rate limits**: each API key's calls a minute, and each MCP caller's, are counted in the shared database, so
  the limit holds across every gateway instance (`429` with `Retry-After`). If the counters can't be reached,
  traffic isn't stopped by them; the per-address limit and the web firewall still apply.
- **Web firewall** (AWS WAF) on the public load balancer: a per-address rate limit, AWS's reputation list, and
  AWS's common and known-bad-input rules for headers, paths and queries. Their body rules only count: prompts
  are large and full of code, and the gateway inspects bodies itself.
- **Secrets** (provider keys, API credentials) are encrypted with the platform's own KMS key.
- **Retention**: each searchable record carries an expiry from its company's retention period. A daily sweep
  (one gateway instance claims each day) deletes the archive's day folders past that period; S3 removes the
  old versions 30 days later. Changing the period re-dates existing records. A **legal hold**, placed by a
  company admin with a reason, removes the expiry from every record and stops the sweep until released.
- **Alarms**: the gateway publishes policy violations, request latency and circuit breakers to CloudWatch
  (embedded metric format, once a minute). Alarms on those and on the gateway's 5xx errors go to an SNS topic,
  emailed to `-c alarmEmail=…`.

## Trust between services

Every call from the gateway to the policy engine, data protection or analytics carries two proofs:

| | Proves | How |
|---|---|---|
| Mutual TLS | *Which service* is calling, and encrypts the connection | Each install has its own private certificate authority; each service a certificate naming it (`scripts/internal-pki.mjs`). Internal services serve only TLS and refuse callers without a certificate from that CA, or from a service that may not call them. The caller checks it reached the service it meant to. |
| Signed token | *For which company and person*, for 60 seconds | ES256. Only the gateway holds the private key (`INTERNAL_SIGNING_KEY`); internal services hold public keys (`INTERNAL_TRUSTED_KEYS`), so a compromised internal service can't make tokens. A request naming another company than its token is refused. |

- An on-prem install's reporting agent has its own key pair and certificate. Its key can sign only
  reporting-agent tokens, and its certificate may carry only those; it may read only framework status and its
  24-hour summary.
- On AWS, services reach each other by private DNS name (Cloud Map, `<service>.<prefix>-<stage>.internal`)
  and connect directly; there is no internal load balancer, which couldn't carry the caller's certificate.
  Each internal service's security group admits only the gateway's.
- Keys and certificates live in Secrets Manager. CDK makes the signing keys on first deploy; the Deploy
  workflow runs `scripts/internal-pki.mjs aws` to make the CA and certificates before deploying.
- **Rotating keys**: add the new public key to `INTERNAL_TRUSTED_KEYS` next to the old one and restart the
  internal services, then give the gateway the new private key, then remove the old public key
  (`scripts/internal-keys.mjs new gateway` makes a pair). **Renewing certificates** (yearly):
  `scripts/internal-pki.mjs aws … --renew`, then redeploy.
- Without TLS settings the services fall back to plain HTTP for tests, and refuse to start that way when
  `NODE_ENV=production` (as every image sets).

## What ships in the images

Each service image (`services/Dockerfile`) holds the service bundled into one file and compiled to V8
bytecode, plus a small loader, on a distroless Node image: no TypeScript or JavaScript source, no source maps,
no `node_modules`, no npm, no shell, running as a non-root user. Bytecode runs only on the Node that compiled
it, so it's compiled inside the runtime image itself. CI checks each image contains only the bytecode; the
Deploy workflow signs each image (Sigstore, keyless) and attaches its software bill of materials.

This makes reading the product slow and expensive, not impossible: on hardware a customer controls, a
determined reverse engineer can still study bytecode. The plan for keeping the most valuable parts off their
hardware is in [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md) (E5, E6).

## Known gaps before production

- CI runs unit tests, builds and image builds on every push, but not the end-to-end suite, which needs
  LocalStack. Deploying is manual only.
- The full AWS deploy (repositories, images, stacks, three sites behind CloudFront) passes CDK synth and unit
  tests but hasn't yet been run against a real AWS account.
- Production deploys need `-c certificateArn=…` and `-c gatewayUrl=…` for HTTPS; the service Dockerfiles
  haven't been built on a developer machine yet (CI builds them).
- Secrets detection covers prompts only. A model that writes a credential into its answer isn't checked by it
  (the existing response scanner catches a few key formats).
- Streamed answers are masked by the gateway's built-in patterns as they stream; the deeper data-protection
  check runs only on non-streamed answers. A pattern longer than 96 characters (a whole private key) can slip
  through when split across chunks.
- A revoked API key stops working at once on the gateway instance that revoked it; other instances drop
  their cached copy within a minute.
- MCP servers (beta): the gateway's signing key isn't rotated yet; sign-in needs `PUBLIC_GATEWAY_URL` set (without it, addresses come from request headers); approval
  waits and connector calls poll the database, which adds load and a little latency.
- Provider keys and API credentials saved before the platform key was set (`PROVIDER_KEYS_KMS_KEY_ID`) stay
  under Secrets Manager's default key until they're saved again.
- The web firewall's per-address limit sees CloudFront's addresses for dashboard traffic, so it's set high
  (3000 per 5 minutes); per-key limits are what bound each app.
- Logs: service log lines don't carry the request ID automatically, and there is no access log line per
  request. Some MCP log lines carry people's emails.
- Log export (beta): formats follow each vendor's published intake but haven't been tried against the real
  products.
