# Aegis — architecture

## Request path (apps)

```
App ──POST /v1/chat/completions──▶ Gateway (:3000)
   Authorization: Bearer <Aegis key>   │
                                       ├─ 1. Auth: key → tenant (from the key record, never from headers),
                                       │       scope check, tenant not suspended
                                       ├─ 2. Policy engine (:3001) evaluates rules on the ORIGINAL prompt
                                       │       └─ match with action "block" → 403 POLICY_VIOLATION + audit
                                       ├─ 3. Data protection (:3002) removes personal data
                                       ├─ 4. Provider: Bedrock (IAM role) or OpenAI-compatible
                                       │       (provider key read from Secrets Manager)
                                       ├─ 5. Response scanned for personal data (in process + service)
                                       └─ 6. Audit record (DynamoDB, queryable) + archive copy (S3, KMS)
```

- Policy runs **before** masking so rules about personal data can see it; only the masked prompt leaves.
- If step 2 or 3 can't run, the tenant's fail mode decides: `closed` (default) returns
  `503 GOVERNANCE_UNAVAILABLE`; `open` continues and marks the audit record `governanceDegraded`.
- Stopped requests keep a short masked excerpt of the trigger in the audit record; delivered prompts are kept
  only as SHA-256 fingerprints.

## Request path (IDEs, proxy mode)

```
IDE ──▶ corporate proxy ──▶ Gateway /v1/proxy/:provider/*  ──▶ provider
         adds X-Aegis-Key      checks policy on extracted text   (developer's own key, untouched)
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

## Testing

- **Unit tests** in each workspace: `npm test` from the root, plus the browser extension's
  `node --test extensions/shadow-ai-guard/tests/lib.test.mjs`.
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
nothing else installed. Planned: [ASSESSMENT.md](ASSESSMENT.md).

## Known gaps before production

- The CI and deploy workflows are in `ai-governance-platform/.github/workflows/`, but GitHub only runs workflows
  from the repository root, so they don't run. Moving them also turns on `deploy.yml`, which deploys to AWS on
  every push to `main`.

- Production deploys need `-c certificateArn=…` for HTTPS; the service Dockerfiles haven't been built on a
  developer machine yet (CI builds them).
- Streaming responses and secrets detection are not built yet.
- A revoked API key stops working at once on the gateway instance that revoked it; other instances drop
  their cached copy within a minute.
- Policy engine, data protection and analytics have no service-to-service authentication; they rely on
  being reachable only inside the VPC.
