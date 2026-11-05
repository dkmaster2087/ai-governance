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
                                       └─ 7. Audit record (DynamoDB, queryable) + archive copy (S3, KMS)
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

| Data | Where |
|---|---|
| Tenants, settings (fail mode, shadow-AI decisions) | DynamoDB `tenants` |
| Policies and rules | DynamoDB `policies` |
| API keys (SHA-256 hashes only) | DynamoDB `api-keys`, index `keyHash-index` |
| Model configs (secret ARN + hint only) | DynamoDB `models`; provider keys in Secrets Manager |
| Audit records | DynamoDB `audit-logs` (index `tenantId-timestamp-index`) + S3 archive |
| Shadow-AI events (30-day TTL) | DynamoDB `shadow-ai` |

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
nothing else installed. Plan: [ASSESSMENT.md](ASSESSMENT.md); the core, the AWS collector and the on-premises collector are built in
[collector/](../collector/README.md).

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
- Policy engine, data protection and analytics have no service-to-service authentication; they rely on
  being reachable only inside the VPC.
