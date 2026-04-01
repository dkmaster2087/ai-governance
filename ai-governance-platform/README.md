# Aegis AI — Enterprise AI Governance Platform

A centralized AI control plane that enforces policy, masks sensitive data, and audits every AI interaction.

## Structure

```
ai-governance-platform/
├── services/
│   ├── gateway/          # AI proxy — Fastify, port 3000
│   ├── policy-engine/    # Policy evaluation — Fastify, port 3001
│   ├── data-protection/  # PII masking — Fastify, port 3002
│   └── analytics/        # Metrics & audit queries — Fastify, port 3003
├── frontend/
│   ├── website/          # Marketing site — React + Vite + Tailwind
│   └── dashboard/        # Ops dashboard — React + Vite (coming)
├── infra/                # AWS CDK — all infrastructure
└── shared/
    ├── types/            # Shared TypeScript types
    └── utils/            # Shared utilities
```

## Quick Start

```bash
cp .env.example .env
npm install
npm run build
npm run dev
```

## CDK Deploy

```bash
cd infra
npm install
npx cdk bootstrap
npx cdk deploy --all --context stage=dev
```

## CDK Teardown

```bash
cd infra
npx cdk destroy --all --force --context stage=dev
```

Or trigger via GitHub Actions → Deploy workflow → set `destroy: true`.

## Tests

```bash
npm test                          # all packages
npx turbo run test --filter=...   # specific package
```

## GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN for OIDC deployment |
| `AWS_ACCOUNT_ID` | AWS account ID |
| `WEBSITE_BUCKET_NAME` | S3 bucket for website |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution ID |

## Architecture

```
Client → API Gateway → ECS Gateway → Policy Engine → PII Masking → AI Provider
                                                                  ↓
                                                          Response Filter → Client
                                                                  ↓
                                                          S3 Audit Logs (KMS encrypted)
```

VPC: 2 public subnets + 4 private subnets (2 app, 2 data) across 2 AZs. Single NAT Gateway.
