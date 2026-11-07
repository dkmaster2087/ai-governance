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
```

## Deploy to AWS

```bash
cd infra
npm install
npx cdk bootstrap
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
  certificate in us-east-1 (`--context cloudfrontCertificateArn=…`).

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
| `INTERNAL_SERVICE_KEY` | gateway, analytics, reporting agent | Key internal requests are signed with (at least 32 characters; from Secrets Manager in AWS) |
| `ALLOWED_ORIGINS` | gateway | Other websites allowed to call the gateway from a browser (comma-separated). Empty means none; the deployed sites don't need any, and the browser extension is always allowed |
| `USERS_TABLE` | gateway | The company people table (set by CDK). With `COGNITO_USER_POOL_ID` set, inviting someone creates their sign-in and emails them |
| `ANALYTICS_URL` | gateway | Where analytics is (set by CDK; local default `http://localhost:3003`) |
| `LICENSE_GRACE_DAYS`, `LICENSE_WARN_DAYS` | gateway | Days AI requests keep working after a license ends, and days of warning before it expires (both default 30) |
| `PUBLIC_GATEWAY_URL` | gateway | The gateway's public address, used for MCP sign-in and signed identity (CDK: `-c gatewayUrl=https://…`). Required for people to sign in |
| `MCP_ALLOW_PRIVATE_BACKENDS` | gateway | `true` lets MCP tools call private addresses: only for a self-hosted gateway inside the company network |
| `MCP_ALLOW_HTTP_BACKENDS` | gateway | `true` allows plain-http APIs (local development only) |
| `MCP_ALLOWED_ORIGINS` | gateway | Browser origins allowed to call MCP addresses (default: none; agents don't send one) |
| `OBJECT_STORE`, `OBJECT_STORE_DIR`, `S3_ENDPOINT` | gateway | Audit archives and contact requests: `s3` (default; `S3_ENDPOINT` for MinIO and other S3-compatible stores) or `file` (a directory) |
| `AUTH_DEV_MODE` | gateway | Local demo sign-in only; refused outside dev stages |
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
