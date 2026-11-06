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

## Dashboard and admin APIs

The dashboard talks only to the gateway. Users sign in with Cognito (ID token, `custom:tenantId`,
`custom:role`); the gateway verifies the token and checks role per route. Platform admins may act on other
tenants via `X-Tenant-Id`; everyone else is limited to their own.

| Gateway endpoint | For |
|---|---|
| `GET /v1/gateway/summary`, `GET /v1/gateway/stopped` | Gateway and Stopped pages (from the audit log) |
| `GET/POST/PATCH/DELETE /v1/rules…`, `GET/PUT /v1/gateway/settings` | Rules page (forwards to the policy engine with the caller's tenant) |
| `GET /v1/shadow-ai/summary`, `GET/PUT /v1/shadow-ai/policy` | Shadow AI page |
| `GET /v1/shadow-ai/config`, `POST /v1/shadow-ai/events` | Browser extension (`shadow_ai:ingest` key; tenant from the key) |
| `GET /v1/evidence…` | Evidence page and exports |
| `GET/POST /v1/api-keys…` | API keys page |
| `GET /v1/activity` | Activity page (admin changes and sign-ins, newest first) |
| `GET/POST/PATCH/DELETE /v1/log-export…` | Log export page: destinations, test, new signing secret, undelivered batches |
| `GET /v1/platform/usage`, `/v1/tenants…`, `/health/deep` | Platform-admin pages (platform admins only, except health) |

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

## Known gaps before production

- CI runs unit tests, builds and image builds on every push, but not the end-to-end suite, which needs
  LocalStack. Deploying is manual only.
- The first deploy to a new AWS account will fail: the deploy workflow pushes images before CDK creates the
  image repositories, and the services stack starts containers from an image that doesn't exist yet. The
  repositories need their own stack (or the services must start at zero tasks) before the first deploy.

- Production deploys need `-c certificateArn=…` for HTTPS; the service Dockerfiles haven't been built on a
  developer machine yet (CI builds them).
- Secrets detection covers prompts only. A model that writes a credential into its answer isn't checked by it
  (the existing response scanner catches a few key formats).
- Streamed answers are masked by the gateway's built-in patterns as they stream; the deeper data-protection
  check runs only on non-streamed answers. A pattern longer than 96 characters (a whole private key) can slip
  through when split across chunks.
- A revoked API key stops working at once on the gateway instance that revoked it; other instances drop
  their cached copy within a minute.
- MCP servers (beta): rate limits are counted per gateway instance; the gateway's signing key isn't rotated
  yet; sign-in needs `PUBLIC_GATEWAY_URL` set (without it, addresses come from request headers); approval
  waits and connector calls poll the database, which adds load and a little latency.
- Policy engine, data protection and analytics have no service-to-service authentication; they rely on
  being reachable only inside the VPC.
- Logs: decision records are written without an expiry, so the tenant's retention setting isn't enforced
  on stored records yet, and the audit bucket has Object Lock on but no default retention rule (versioned,
  not locked). Service log lines don't carry the request ID automatically, and there is no access log line
  per request. Some MCP log lines carry people's emails.
- Log export (beta): the CDK stacks don't yet create the `activity` and `log-export` tables or give
  the gateway access to them (the secrets already fall under the provider-keys policy); until they do, only
  local stages record activity and export logs. Formats follow each vendor's published intake but haven't been tried against
  the real products.
