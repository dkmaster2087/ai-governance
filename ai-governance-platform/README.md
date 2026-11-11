# Probaline — the AI gateway for security teams

Every AI request a company makes passes through one gateway. Probaline checks each prompt before it leaves:
it stops confidential material, removes personal data, shows AI use that goes around it, and keeps evidence
for every decision.

- **Product overview:** [docs/FEATURES.md](docs/FEATURES.md)
- **How it fits together:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Customer docs** live on the website (`frontend/website`, `/docs`).

## Repository

```
services/
  gateway/          Public API: auth, chat completions, proxy mode, rules, evidence, shadow AI (Fastify, :3000)
  policy-engine/    Evaluates rules and compliance packs (internal, :3001)
  data-protection/  Removes personal data from prompts and responses (internal, :3002)
  analytics/        Every report built from history: summaries, spend, evidence, platform view (internal, :3003)
  reporting-agent/  Optional on-prem agent that reports usage with a license key (:3005)
frontend/
  dashboard/        The app (React + Vite + Tailwind, :5174)
  website/          Public website and docs (React + Vite + Tailwind, :5173)
extensions/
  shadow-ai-guard/  Chrome extension for shadow AI (managed through Chrome policy)
collector/          Assessment collector: finds AI use in a company's own logs, installed on its own
connector/          MCP connector: lets the gateway reach APIs inside a company network (outbound HTTPS only)
infra/              AWS CDK stacks
shared/             Shared types and utilities
scripts/            Local development helpers
```

## Run it locally

Requires Docker and Node.js 20+.

```bash
npm install
scripts/dev-local.sh start      # LocalStack, services, mock model, website and dashboard
node scripts/seed-traffic.mjs   # optional: realistic sample traffic
```

- Dashboard: http://localhost:5174, demo sign-in `admin@democorp.com` / `demo123`
- Website: http://localhost:5173
- Gateway: http://localhost:3000
- Stand-in company sign-in for MCP servers: http://localhost:4030 (pick a demo person; client `probaline-dev` /
  `dev-secret`), from `scripts/dev-idp.mjs`

`scripts/dev-local.sh stop` stops the Node processes; `status` shows what's running. Logs are in `.dev-logs/`.
Locally the gateway runs with `AUTH_DEV_MODE=true`, which accepts the demo accounts; it refuses to start
with that setting outside dev/local/test stages.

## Tests

```bash
npm test                                  # all packages
(cd services/gateway && npx jest)         # one package
(cd frontend/dashboard && npx vitest run)
npm run test:e2e                          # the request path through the real services (start the local stack first)
node scripts/load-test.mjs                # time the checks add, and how much a gateway handles (docs/PERFORMANCE.md)
```

CI runs the unit tests, builds every image (checking no readable code ships) and runs the end-to-end suite on
DynamoDB and on PostgreSQL. Restoring from backups: [docs/RESTORE-RUNBOOK.md](docs/RESTORE-RUNBOOK.md).

The connector and collector images, which customers run, are published by pushing a tag
`connector-v<version>` or `collector-v<version>` (`.github/workflows/release-agents.yml`): signed, with a bill
of materials, to GitHub's registry and (with `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN`) Docker Hub as
`probaline/connector` and `probaline/collector`.

## Deploy to AWS

```bash
cd infra
npm install
npx cdk bootstrap
node ../scripts/internal-pki.mjs aws --prefix ai-gov --stage dev   # certificates for mutual TLS, once
npx cdk deploy --all --context stage=dev
```

The stacks create the image repositories (`…-registry-…`), the services, and the three sites: website,
dashboard and docs, each a private S3 bucket behind CloudFront. The dashboard and website reach the gateway on
their own address under `/api`, so browsers never call another origin. Images are tagged with the commit, and a
deploy rolls the services onto that tag (`--context imageTag=<sha>`; the Deploy workflow does this).

Production needs:
- a TLS certificate for the gateway's public listener (`--context certificateArn=arn:aws:acm:…`) and its public
  address (`--context gatewayUrl=https://…`);
- optionally your own domains for the sites: `--context websiteDomain=… dashboardDomain=… docsDomain=…` with a
  certificate in us-east-1 (`--context cloudfrontCertificateArn=…`);
- an email for alarms (`--context alarmEmail=ops@…`); AWS asks that address to confirm.

The web firewall is on by default (`--context waf=false` turns it off; `--context wafRatePerFiveMinutes=…`
changes the per-address limit, default 3000).

Without a certificate, non-production stages serve plain HTTP. See "Known gaps" in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**The first platform admin.** Company admins are invited from the platform (creating a company emails its first
admin), and they invite their own people from the Users page. The platform's own first admin is made once:

```bash
node scripts/create-platform-admin.mjs <user-pool-id> you@example.com "First" "Last"
```

### Configuration

| Variable | Service | Purpose |
|---|---|---|
| `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | gateway | Verify dashboard sign-ins |
| `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID` | dashboard | Sign-in for deployed dashboards |
| `VITE_GATEWAY_PUBLIC_URL` | dashboard | Gateway address shown to admins (defaults to the dashboard's `/api`) |
| `GOVERNANCE_FAIL_MODE` | gateway | Default when a check can't run: `closed` (block) or `open` |
| `PROVIDER_KEYS_SECRET_PREFIX` | gateway | Secrets Manager prefix for customers' provider keys |
| `STORAGE_BACKEND` | gateway, policy engine, analytics | `dynamodb` (default), `postgres` or `memory` |
| `DATABASE_URL`, `PG_TABLE_PREFIX` | same | PostgreSQL connection (`?sslmode=require` for TLS) and optional table prefix |
| `MCP_SERVERS_TABLE`, `MCP_APIS_TABLE`, `MCP_TOOLS_TABLE`, `MCP_VERSIONS_TABLE`, `MCP_APPROVALS_TABLE`, `MCP_OAUTH_TABLE`, `MCP_CONNECTORS_TABLE` | gateway | DynamoDB tables for MCP servers (set by CDK) |
| `INTERNAL_SIGNING_KEY` | gateway, reporting agent | The private key internal requests are signed with, as JSON `{"iss","privateKey"}` (`scripts/internal-keys.mjs`; Secrets Manager in AWS) |
| `INTERNAL_TRUSTED_KEYS` | policy engine, data protection, analytics, reporting agent | Public keys accepted, as a JSON list; two during a rotation. The services refuse to start without it |
| `INTERNAL_TLS_CA`, `INTERNAL_TLS_CERT`, `INTERNAL_TLS_KEY` | all services | Mutual TLS between services: the install's CA and this service's certificate and key, as PEM (`scripts/internal-pki.mjs`). Required in production |
| `PROVIDER_KEYS_KMS_KEY_ID` | gateway | KMS key that new provider keys and API credentials are encrypted with (set by CDK to the platform's key) |
| `METRICS_NAMESPACE` | gateway | Publish alarm metrics to CloudWatch under this namespace (set by CDK; off when unset) |
| `ALLOWED_ORIGINS` | gateway | Other websites allowed to call the gateway from a browser (comma-separated). Empty means none; the deployed sites don't need any, and the browser extension is always allowed |
| `USERS_TABLE` | gateway | The company people table (set by CDK). With `COGNITO_USER_POOL_ID` set, inviting someone creates their sign-in and emails them |
| `ANALYTICS_URL` | gateway | Where analytics is (set by CDK; local default `http://localhost:3003`) |
| `LICENSE_GRACE_DAYS`, `LICENSE_WARN_DAYS` | gateway | Days AI requests keep working after a license ends, and days of warning before it expires (both default 30) |
| `PUBLIC_GATEWAY_URL` | gateway | The gateway's public address, used for MCP sign-in and signed identity (CDK: `-c gatewayUrl=https://…`). Required for people to sign in |
| `MCP_ALLOW_PRIVATE_BACKENDS` | gateway | `true` lets MCP tools call private addresses: only for a self-hosted gateway inside the company network |
| `MCP_ALLOW_HTTP_BACKENDS` | gateway | `true` allows plain-http APIs (local development only) |
| `MCP_ALLOWED_ORIGINS` | gateway | Browser origins allowed to call MCP addresses (default: none; agents don't send one) |
| `OBJECT_STORE`, `OBJECT_STORE_DIR`, `S3_ENDPOINT` | gateway | Audit archives and contact requests: `s3` (default; `S3_ENDPOINT` for MinIO and other S3-compatible stores) or `file` (a directory) |
| `ACTIVITY_TABLE`, `LOG_EXPORT_TABLE` | gateway | DynamoDB tables for admin activity and sign-ins, and log export destinations |
| `ACTIVITY_RETENTION_DAYS` | gateway | How long admin activity and sign-ins are kept (default 400) |
| `LOG_EXPORT_WORKER` | gateway | `off` stops this gateway from sending records to companies' log destinations |
| `LOG_EXPORT_INTERVAL_MS`, `LOG_EXPORT_SETTLE_MS`, `LOG_EXPORT_RETRY_BASE_MS`, `LOG_EXPORT_MAX_ATTEMPTS`, `LOG_EXPORT_BATCH_SIZE` | gateway | Log export timing: every 10 s, records at least 30 s old, retries from 30 s doubling, 5 tries, 100 per batch |
| `LOG_EXPORT_ALLOW_PRIVATE_DESTINATIONS`, `LOG_EXPORT_ALLOW_HTTP` | gateway | `true` lets log export send to private addresses (self-hosted inside the company network) or plain http (local only) |
| `AUTH_DEV_MODE` | gateway | Local demo sign-in only; refused outside dev stages |
| `EMAIL_FROM` | gateway | Sender for website enquiries and alerts, verified in Amazon SES (CDK: `-c emailFrom=…`). Email is off without it |
| `CONTACT_EMAIL_TO` | gateway | Who receives the website's contact form, comma-separated (CDK: `-c contactEmail=…`); enquiries are also kept in the audit bucket |
| `DASHBOARD_URL` | gateway | The dashboard's address, linked from alert emails (CDK: from `-c dashboardDomain=…`) |
| `SECRET_STORE` | gateway | Where secrets are kept: `aws` (Secrets Manager, default) or `database` (encrypted in the database, for installs without AWS) |
| `SECRETS_ENCRYPTION_KEY`, `SECRETS_ENCRYPTION_KEY_OLD` | gateway | With `SECRET_STORE=database`: 32 random bytes, base64 (`openssl rand -base64 32`). To change it, set the new key and keep the old as `_OLD` until secrets are saved again. Keep it apart from database backups |
| `MCP_KEY_ROTATE_DAYS`, `MCP_KEY_OVERLAP_DAYS` | gateway | How often the MCP signing key rotates (default 90 days) and how long old and next keys stay published (default 7) |
| `GLOBAL_RATE_LIMIT` | gateway | Requests a minute from one address (the web firewall applies its own limit in AWS) |
| `TRUSTED_PROXY_HOPS` | gateway | How many proxies you run in front of the gateway (default 0). Only the `X-Forwarded-For` entries they add are believed; set 1 behind one load balancer or nginx. AWS sets 1 |
| `EDGE_SECRET` | gateway | On AWS, the secret CloudFront sends in `x-probaline-edge`; requests carrying it have CloudFront's entry believed too. Set by the deployment |
| `VITE_API_URL`, `VITE_DASHBOARD_URL` | website, docs | Gateway and dashboard addresses. `scripts/check-build-env.mjs` refuses a deployed build without them, or with localhost |
| `PROBALINE_LICENSE_KEY`, `TENANT_ID`, `PROBALINE_REPORTING_URL`, `REPORTING_ENABLED` | reporting agent | On-prem installs only: the license, the company, the platform's reporting address (e.g. `https://app.example/api/v1/reporting`) and whether to send reports |
| `REPORT_USAGE`, `REPORT_COST`, `REPORT_COMPLIANCE`, `REPORTING_INTERVAL_SECONDS` | reporting agent | What to send (each default `true`; audit records are never sent) and how often (default 300) |

### CI and deployment

The workflows live in `.github/workflows/` at the repository root (one level above this folder).

- **CI** (`ci.yml`) runs on every push and pull request: all unit tests, every build, the CDK synth, and a
  build of each container image. It never deploys and needs no secrets.
- **Deploy** (`deploy.yml`) runs only when started by hand (Actions → Deploy → Run workflow), for a chosen
  stage, or to tear one down. A push never deploys.
- The end-to-end suite (`npm run test:e2e`) needs the local stack and isn't run in CI yet.

Deploy runs in order: image repositories, images (tagged with the commit), the stacks, then the three sites
(built with the addresses the stacks report, then uploaded and the CloudFront cache cleared).

Repository secrets:

| Secret | Description |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN for OIDC deployment |
| `AWS_ACCOUNT_ID` | AWS account ID |

Variables on each GitHub environment (`dev`, `staging`, `prod`), all optional outside production:

| Variable | Description |
|---|---|
| `GATEWAY_URL` | The gateway's public `https://` address (required in production) |
| `CERTIFICATE_ARN` | Certificate for the gateway's listener (required in production) |
| `WEBSITE_DOMAIN`, `DASHBOARD_DOMAIN`, `DOCS_DOMAIN` | Your own domains for the sites |
| `CLOUDFRONT_CERTIFICATE_ARN` | us-east-1 certificate covering those domains |
| `ALARM_EMAIL` | Who is emailed when an alarm goes off |
| `EMAIL_FROM` | Sender for website enquiries and alerts, verified in SES (e.g. `Probaline <no-reply@probaline.com>`) |
| `CONTACT_EMAIL` | Who receives website enquiries (comma-separated) |
