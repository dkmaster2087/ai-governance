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
  checks down. Start the local stack (`scripts/dev-local.sh start`), then `npm run test:e2e`. Not in CI yet
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
