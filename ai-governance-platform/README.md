# Aegis — the AI gateway for security teams

Every AI request a company makes passes through one gateway. Aegis checks each prompt before it leaves:
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
  analytics/        Usage metrics for the platform view (internal, :3003)
  reporting-agent/  Optional on-prem agent that reports usage with a license key (:3005)
frontend/
  dashboard/        The app (React + Vite + Tailwind, :5174)
  website/          Public website and docs (React + Vite + Tailwind, :5173)
extensions/
  shadow-ai-guard/  Chrome extension for shadow AI (managed through Chrome policy)
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

Production needs a TLS certificate for the gateway's public listener:
`npx cdk deploy --all --context stage=prod --context certificateArn=arn:aws:acm:…`. Without one, non-production
stages serve plain HTTP. See "Known gaps" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Configuration

| Variable | Service | Purpose |
|---|---|---|
| `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | gateway | Verify dashboard sign-ins |
| `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID` | dashboard | Sign-in for deployed dashboards |
| `VITE_GATEWAY_PUBLIC_URL` | dashboard | Gateway address shown to admins (defaults to the dashboard's `/api`) |
| `GOVERNANCE_FAIL_MODE` | gateway | Default when a check can't run: `closed` (block) or `open` |
| `PROVIDER_KEYS_SECRET_PREFIX` | gateway | Secrets Manager prefix for customers' provider keys |
| `AUTH_DEV_MODE` | gateway | Local demo sign-in only; refused outside dev stages |
| `VITE_API_URL`, `VITE_DASHBOARD_URL` | website | Gateway and dashboard addresses |

### GitHub secrets for CI/CD

| Secret | Description |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN for OIDC deployment |
| `AWS_ACCOUNT_ID` | AWS account ID |
| `WEBSITE_BUCKET_NAME` | S3 bucket for the website |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution ID |
