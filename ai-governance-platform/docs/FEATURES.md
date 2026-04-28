# Aegis AI — Platform Features

## Overview

Aegis AI is an enterprise AI governance platform that sits between your organization and AI providers. It enforces policies, masks sensitive data, audits every interaction, and gives compliance teams full visibility — without slowing developers down.

Two deployment modes: **SaaS** (managed cloud) and **On-Premises** (full data sovereignty).
Two integration modes: **Managed** (Aegis holds API keys) and **Transparent Proxy** (client credentials pass through).

---

## Core Platform

### AI Gateway
The central routing layer. All AI traffic flows through the gateway, which normalizes requests across providers and enforces governance at every step.

- **Managed mode**: Aegis stores provider API keys and routes to the correct provider based on model ID prefix. Clients authenticate with tenant headers.
- **Proxy mode**: Transparent passthrough for IDE traffic (Kiro, Copilot, Cursor). Client credentials forwarded as-is. Corporate proxy redirects `api.openai.com` → Aegis. Zero client-side changes.
- **Supported providers**: Amazon Bedrock, OpenAI, Anthropic, Cohere, Mistral
- **OpenAI-compatible API**: `POST /v1/chat/completions` — existing apps work with a URL change
- **Proxy endpoint**: `POST /v1/proxy/:provider/*` — e.g., `/v1/proxy/openai/v1/chat/completions`

### Policy Engine
Real-time policy evaluation on every request. Runs before the request reaches any AI provider.

- **Rule types**: Keyword blocking, PII detection, model restrictions, content classification, region enforcement
- **Per-tenant policies**: Each tenant configures their own rules
- **Framework-linked policies**: Enabling a compliance framework auto-creates a linked policy with required controls
- **1:1 framework-policy linking**: Disable a framework → disables linked policy. Delete a policy → disables linked framework.
- **Fail-open configurable**: If the policy engine is unreachable, requests can be allowed with a warning (configurable per tenant)

### PII & Data Protection
Sensitive data detection and masking before prompts reach AI providers, and response scanning on the way back.

- **Detection methods**: Regex patterns + Amazon Comprehend (deep NLP-based PII detection)
- **Actions**: Mask, block, or tokenize
- **Supported PII types**: Names, emails, phone numbers, SSNs, credit cards, dates of birth, medical records, and more
- **Response scanning**: AI responses are scanned for PII leakage before returning to the client

---

## Compliance & Audit

### Compliance Frameworks
Six industry-standard frameworks built in, each with predefined controls and auto-generated policies.

| Framework | Description |
|-----------|-------------|
| **NIST AI RMF** | US AI risk management framework — govern, map, measure, manage |
| **SOC 2** | Service organization controls for security, availability, processing integrity |
| **GDPR** | EU General Data Protection Regulation — data minimization, consent, right to erasure |
| **HIPAA** | US healthcare — PHI detection, BAA requirements, access controls |
| **ISO 42001** | International AI management system standard |
| **PIPEDA** | Canadian Personal Information Protection and Electronic Documents Act |

- Enable a framework → auto-creates a linked policy with required rules
- Disable a framework → auto-disables the linked policy
- Delete/disable a policy → auto-disables the linked framework
- Per-control assessment with pass/fail status and progress tracking

### Audit Logs
Complete audit trail of every AI interaction.

- Every request logged: user, tenant, model, prompt, response, policy decision, tokens, latency, cost
- **Time-period filtering**: 1h, 3h, 7h, 24h, 3d, 7d, 30d, custom date range
- **Export**: CSV download and PDF print
- **Per-tenant isolation**: Tenant admins see only their data
- **Platform admin view**: Filter across all tenants

---

## Cost & Analytics

### Cost Tracking
Per-user and per-tenant cost breakdowns based on model pricing.

- **Cost summary**: Total cost, daily breakdown, cost by model, cost by user
- **Budget tracking**: Budget progress bar with configurable thresholds
- **Daily cost chart**: Bar chart with trend visualization
- **Model cost breakdown**: Pie chart showing cost distribution across models
- **Top users table**: Ranked by cost with request counts
- **Platform admin**: Cross-tenant cost comparison

### Usage Analytics
Platform-wide and per-tenant usage dashboards.

- **Request volume**: Area chart with requests and blocked counts over time
- **Model distribution**: Interactive pie chart with hover projection
- **Tenant filtering**: Platform admin can filter analytics by tenant
- **Time period selection**: 7d, 30d, 90d views
- **Model usage bars**: Per-model request counts with cost

---

## Shadow AI Detection

### Browser Extension (Shadow AI Guard)
Chrome Manifest V3 extension that monitors and blocks unauthorized AI tool usage.

- **Modes**: Monitor (detect and log) or Block (prevent access and redirect)
- **Blocked domains**: ChatGPT, Claude, Copilot, DeepSeek, Gemini, Perplexity, and more
- **Per-tenant configuration**: Each tenant sets their own mode and blocked domains
- **Real-time**: Intercepts navigation before the page loads
- **Reporting**: Events sent to the gateway for dashboard visibility

### Shadow AI Dashboard
- **Risk score**: Aggregate risk assessment based on bypass attempts
- **Bypass attempts chart**: Daily bar chart with color-coded severity
- **Targeted endpoints**: Which AI tools employees are trying to access
- **Top bypass users**: Ranked by attempt count with department info
- **Recent events**: Real-time feed of detected/blocked attempts
- **Tenant filter**: Platform admin can view per-tenant shadow AI data
- **Time period filter**: 1h, 3h, 24h, 3d, 7d, 30d

---

## Content Scanner
Upload documents for PII and sensitive content scanning.

- **File support**: Up to 500MB uploads with progress tracking
- **Text extraction**: Capped at 1MB for performance
- **Upload progress**: Real-time percentage bar
- **10-minute timeout**: For large file processing
- **Findings report**: Detailed results with PII type, location, and severity

---

## Multi-Tenant Architecture

### Tenant Management
- **Onboarding wizard**: 3-tab modal — Basic Info, License, Settings
- **Tenant types**: SaaS (cloud) or On-Premises
- **Plans**: Starter, Professional, Enterprise
- **Per-tenant settings**: Max tokens, rate limits, log retention, data residency region, PII masking toggle, external provider toggle
- **Tenant status**: Active, Trial, Suspended
- **Admin account auto-creation**: Onboarding generates a login account with configurable password

### License Management
- **License key generation**: Auto-generated during onboarding or from the Licenses page
- **Configurable**: Max users, validity period (1 month to 3 years), deployment type
- **License store**: Persisted and visible in the platform admin Licenses page
- **Tenant license view**: Tenant admins see their license status, user capacity, days remaining, and reporting config
- **Reporting configuration**: Per-tenant toggle for what data syncs to the SaaS platform (usage metrics, cost data, compliance status, audit logs)

### Role-Based Access Control
Four roles with different access levels:

| Role | Access |
|------|--------|
| **Platform Admin** | Super admin dashboard — tenants, licenses, analytics, cost, shadow AI, platform health, settings |
| **Tenant Admin** | Full tenant dashboard — AI chat, audit logs, policies, compliance, models, cost, users, content scanner, shadow AI, license, settings |
| **Tenant Auditor** | Overview, AI chat, audit logs |
| **Tenant User** | AI chat only |

- Route guards enforce access per role
- Dynamic sidebar shows only permitted navigation items
- Platform admin gets a separate dashboard with cross-tenant visibility

---

## Platform Admin Dashboard

### Overview
Aggregated view across all tenants.

- **Stat cards**: Total tenants, active licenses, total users, monthly revenue, total requests
- **Charts**: Monthly revenue trend, tenants by deployment type (pie), tenants by plan (pie)
- **Tenant table**: Real-time data — name, type, plan, requests, policies, frameworks, cost, status
- **Clickable rows**: Navigate to tenant detail page

### Tenant Detail Page
Deep-dive into any tenant with 9 tabs:

- **Overview**: Users, requests, cost, license key
- **Analytics**: Request volume and daily cost charts
- **Models**: Real model configs from backend
- **Policies**: Real policies with enabled/disabled status
- **Compliance**: Real framework status with progress bars
- **Audit**: Link to tenant's audit view
- **Users**: Real user list from auth store
- **Cost**: Per-model cost breakdown
- **License**: License details, user capacity, reporting config

### Platform Health
Real-time service health monitoring.

- **Pings**: Gateway (3000), Policy Engine (3001), Analytics (3003), Content Scanner (3004)
- **Status**: Healthy/Unhealthy with measured latency
- **Error display**: Shows error message when a service is unreachable
- **Auto-refresh**: Every 30 seconds with manual refresh button

---

## Model Configuration

### Per-Tenant Model Management
- **Add/edit models**: Model ID, display name, provider, endpoint, max tokens, context window
- **Provider support**: Bedrock, OpenAI (with stored API key)
- **Validation**: Max token and context window limits per model with red error indicators
- **Status**: Active, Testing, Disabled — with badges
- **Connection testing**: Verify API key and endpoint connectivity
- **Info tooltips**: Hover for model limit details

---

## AI Chat (Governed)
Built-in chat interface that routes through the governance gateway.

- **Model selector**: Choose from tenant's active models
- **Policy enforcement**: Blocked requests show policy violation message
- **PII masking**: Sensitive data masked before reaching the provider
- **Audit logging**: Every message logged with tokens, latency, model
- **Keyboard shortcuts**: Enter to send, Shift+Enter for new line

---

## Deployment

### SaaS
- Fully managed, multi-tenant
- Automatic updates and security patches
- Global availability via AWS regions
- Pay-as-you-go pricing

### On-Premises
- Deploy in your own AWS account or data center
- Complete data sovereignty
- Air-gapped deployment option
- License key activation with configurable validity
- Configurable reporting — choose what syncs to SaaS platform

### Enterprise Proxy Setup
For governing IDE traffic (Kiro, Copilot, Cursor) without client-side changes:

```
Developer IDE → Corporate Proxy/DNS → Aegis Gateway → Policy Check → AI Provider
```

The corporate proxy redirects AI provider domains to the Aegis gateway. The IDE thinks it's talking to the provider directly. Aegis inspects, governs, logs, and forwards.

---

## Technical Stack

### Backend Services
| Service | Port | Technology |
|---------|------|------------|
| Gateway | 3000 | Fastify, TypeScript |
| Policy Engine | 3001 | Fastify, TypeScript |
| Analytics | 3003 | Fastify, TypeScript |
| Content Scanner | 3004 | Fastify, TypeScript |

### Frontend
| App | Port | Technology |
|-----|------|------------|
| Dashboard | 5174 | React, TypeScript, Vite, Tailwind CSS, Recharts |
| Website | 5173 | React, TypeScript, Vite, Tailwind CSS |

### Infrastructure
- **Database**: DynamoDB (via LocalStack for local dev)
- **Storage**: S3 for audit logs and temp scan files
- **Container**: Docker (LocalStack)
- **IaC**: AWS CDK
