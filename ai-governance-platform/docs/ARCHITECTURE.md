# Aegis AI — Architecture Diagrams

## 1. Managed Mode

In managed mode, Aegis owns the AI provider credentials. Clients authenticate with Aegis using tenant headers. Aegis routes to the correct provider based on model ID.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                  │
│                                                                         │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐               │
│   │  Web App /   │   │  Aegis AI    │   │  Backend     │               │
│   │  Dashboard   │   │  Chat UI     │   │  Service     │               │
│   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘               │
│          │                  │                   │                        │
│          │   POST /v1/chat/completions          │                        │
│          │   Headers: x-tenant-id, x-user-id    │                        │
│          │   Auth: Bearer <aegis-tenant-key>     │                        │
│          └──────────────────┼───────────────────┘                        │
│                             │                                            │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        AEGIS AI GATEWAY (:3000)                         │
│                                                                         │
│   ┌─────────────┐    ┌──────────────┐    ┌──────────────┐               │
│   │    Auth      │───▶│   Policy     │───▶│  PII Mask    │               │
│   │  Middleware  │    │  Evaluation  │    │  (Request)   │               │
│   │             │    │  (:3001)     │    │              │               │
│   │ • Validate  │    │              │    │ • Regex      │               │
│   │   tenant ID │    │ • Keywords   │    │ • Comprehend │               │
│   │ • Validate  │    │ • PII rules  │    │ • Mask/Block │               │
│   │   API key   │    │ • Model      │    │              │               │
│   │             │    │   restrict   │    │              │               │
│   └─────────────┘    │ • Compliance │    └──────┬───────┘               │
│                      └──────────────┘           │                        │
│                                                  │                        │
│                           ┌──────────────────────┘                        │
│                           │                                               │
│                           ▼                                               │
│                  ┌─────────────────┐                                      │
│                  │ Provider Router │                                      │
│                  │                 │                                      │
│                  │ Model ID prefix │                                      │
│                  │ determines      │                                      │
│                  │ provider:       │                                      │
│                  │                 │                                      │
│                  │ anthropic.*     │──────▶ Bedrock (AWS IAM creds)       │
│                  │ amazon.*        │──────▶ Bedrock (AWS IAM creds)       │
│                  │ meta.*          │──────▶ Bedrock (AWS IAM creds)       │
│                  │ gpt-*           │──────▶ OpenAI  (stored API key)      │
│                  └────────┬────────┘                                      │
│                           │                                               │
│                           ▼                                               │
│                  ┌─────────────────┐                                      │
│                  │ Response Scan   │                                      │
│                  │ + Audit Log     │                                      │
│                  │ + Cost Track    │                                      │
│                  └────────┬────────┘                                      │
│                           │                                               │
└───────────────────────────┼───────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        AI PROVIDERS                                     │
│                                                                         │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐               │
│   │   Amazon     │   │   OpenAI     │   │  Anthropic   │               │
│   │   Bedrock    │   │   API        │   │  (Direct)    │               │
│   │              │   │              │   │              │               │
│   │ Claude       │   │ GPT-4o       │   │ Claude       │               │
│   │ Titan        │   │ GPT-3.5      │   │ (non-Bedrock)│               │
│   │ Llama        │   │              │   │              │               │
│   └──────────────┘   └──────────────┘   └──────────────┘               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

KEY POINTS — MANAGED MODE:
• Aegis holds all provider API keys (stored in DynamoDB per tenant)
• Client only needs an Aegis tenant key
• Model configs define which models each tenant can use
• Provider routing is automatic based on model ID prefix
• Bedrock uses AWS IAM credentials from the Aegis server environment
• OpenAI uses per-tenant API keys stored in model config
```

---

## 2. Transparent Proxy Mode

In proxy mode, Aegis is invisible to the client. A corporate proxy/DNS redirects AI provider traffic through Aegis. Client credentials pass through untouched.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DEVELOPER WORKSTATION                            │
│                                                                         │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐               │
│   │    Kiro      │   │   GitHub     │   │   Cursor     │               │
│   │    IDE       │   │   Copilot    │   │   IDE        │               │
│   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘               │
│          │                  │                   │                        │
│          │  Thinks it's talking to api.openai.com / api.anthropic.com   │
│          │  Uses its own API key (Authorization: Bearer sk-xxx)          │
│          └──────────────────┼───────────────────┘                        │
│                             │                                            │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     CORPORATE NETWORK LAYER                             │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────┐       │
│   │                  Corporate Proxy / DNS                       │       │
│   │                                                              │       │
│   │   api.openai.com    ──▶  aegis-gateway:3000/v1/proxy/openai │       │
│   │   api.anthropic.com ──▶  aegis-gateway:3000/v1/proxy/anthropic      │
│   │   api.cohere.ai     ──▶  aegis-gateway:3000/v1/proxy/cohere│       │
│   │   api.mistral.ai    ──▶  aegis-gateway:3000/v1/proxy/mistral       │
│   │                                                              │       │
│   │   + Injects: x-tenant-id header based on user/IP/cert       │       │
│   │                                                              │       │
│   └──────────────────────────┬──────────────────────────────────┘       │
│                              │                                           │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    AEGIS AI GATEWAY (:3000)                              │
│                    Proxy Endpoint: /v1/proxy/:provider/*                 │
│                                                                         │
│   ┌─────────────┐                                                       │
│   │  1. Extract │    Parses request body to find prompt/messages         │
│   │     Prompt  │    Supports: OpenAI, Anthropic, Cohere formats         │
│   └──────┬──────┘                                                       │
│          │                                                               │
│          ▼                                                               │
│   ┌─────────────┐                                                       │
│   │  2. Policy  │    Sends extracted prompt to Policy Engine (:3001)     │
│   │  Evaluation │    Same rules as managed mode:                         │
│   │             │    • Keyword blocking                                  │
│   │             │    • PII detection                                     │
│   │             │    • Model restrictions                                │
│   │             │    • Compliance controls                               │
│   └──────┬──────┘                                                       │
│          │                                                               │
│          ├── BLOCKED ──▶ Return 403 + policy violation details           │
│          │                                                               │
│          ▼ ALLOWED                                                       │
│   ┌─────────────┐                                                       │
│   │  3. Forward │    Forwards ORIGINAL request to real provider          │
│   │  to Provider│    • Client's Authorization header passed through      │
│   │             │    • Client's Content-Type passed through              │
│   │             │    • Provider-specific headers passed through          │
│   │             │    • Aegis does NOT inject its own API keys            │
│   └──────┬──────┘                                                       │
│          │                                                               │
│          ▼                                                               │
│   ┌─────────────┐                                                       │
│   │  4. Audit   │    Logs: tenant, user, model, tokens, latency, cost   │
│   │     Log     │    Adds: x-aegis-request-id header to response        │
│   └──────┬──────┘                                                       │
│          │                                                               │
│          ▼                                                               │
│   Return provider response to client (unchanged)                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        AI PROVIDERS (Real)                               │
│                                                                         │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐               │
│   │   OpenAI     │   │  Anthropic   │   │   Cohere     │               │
│   │   API        │   │  API         │   │   API        │               │
│   └──────────────┘   └──────────────┘   └──────────────┘               │
│                                                                         │
│   ┌──────────────┐                                                      │
│   │   Mistral    │                                                      │
│   │   API        │                                                      │
│   └──────────────┘                                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

KEY POINTS — PROXY MODE:
• Aegis does NOT hold provider API keys
• Client's own credentials pass through untouched
• Corporate proxy/DNS does the redirect — IDE has no idea Aegis exists
• Same policy engine evaluates prompts (keywords, PII, compliance)
• Full audit logging with token counts and cost tracking
• x-tenant-id injected by corporate proxy (based on user identity/IP/cert)
• If policy blocks → client gets 403 (IDE shows error)
• If policy allows → request forwarded, response returned unchanged
```

---

## 3. Side-by-Side Comparison

```
┌────────────────────┬──────────────────────┬──────────────────────┐
│                    │    MANAGED MODE      │    PROXY MODE        │
├────────────────────┼──────────────────────┼──────────────────────┤
│ API Keys           │ Stored in Aegis      │ Client's own keys    │
│ Client Auth        │ Aegis tenant key     │ Provider API key     │
│ Client Changes     │ Change base URL      │ None (DNS redirect)  │
│ Model Config       │ Required in Aegis    │ Not required         │
│ Provider Routing   │ Automatic by prefix  │ Explicit in URL path │
│ Policy Evaluation  │ ✓ Full               │ ✓ Full               │
│ PII Masking        │ ✓ Request + Response │ ✓ Request only*      │
│ Audit Logging      │ ✓ Full               │ ✓ Full               │
│ Cost Tracking      │ ✓ Full               │ ✓ Token-based        │
│ Use Case           │ Internal apps, chat  │ IDE governance       │
│ Setup Effort       │ Low (URL change)     │ Medium (proxy/DNS)   │
└────────────────────┴──────────────────────┴──────────────────────┘

* Response PII masking in proxy mode would alter the provider's response,
  which may break IDE integrations. Currently logs but does not modify.
```

---

## 4. Data Flow — Shared Infrastructure

Both modes share the same backend infrastructure for governance:

```
                    ┌─────────────────────────────────────┐
                    │         AEGIS BACKEND SERVICES       │
                    │                                      │
  Managed ─────┐   │   ┌──────────┐    ┌──────────────┐  │
  or Proxy ────┤──▶│   │ Gateway  │───▶│ Policy Engine │  │
  requests     │   │   │  :3000   │    │    :3001      │  │
               │   │   └────┬─────┘    └──────────────┘  │
               │   │        │                              │
               │   │        ▼                              │
               │   │   ┌──────────┐    ┌──────────────┐  │
               │   │   │  Audit   │    │  Analytics   │  │
               │   │   │  Service │    │    :3003      │  │
               │   │   └────┬─────┘    └──────────────┘  │
               │   │        │                              │
               │   │        ▼                              │
               │   │   ┌──────────────────────────────┐   │
               │   │   │        DynamoDB Tables        │   │
               │   │   │                               │   │
               │   │   │  • ai-gov-policies-dev        │   │
               │   │   │  • ai-gov-compliance-dev      │   │
               │   │   │  • ai-gov-tenants-dev         │   │
               │   │   │  • ai-gov-models-dev          │   │
               │   │   │  • ai-gov-audit-logs-dev      │   │
               │   │   │  • ai-gov-shadow-ai-dev       │   │
               │   │   └──────────────────────────────┘   │
               │   │                                      │
               │   └──────────────────────────────────────┘
               │
               │   ┌──────────────────────────────────────┐
               │   │         FRONTEND APPS                 │
               │   │                                       │
               │   │   ┌──────────┐    ┌──────────────┐   │
               │   │   │Dashboard │    │   Website     │   │
               │   │   │  :5174   │    │    :5173      │   │
               │   │   └──────────┘    └──────────────┘   │
               │   └──────────────────────────────────────┘
               │
               │   ┌──────────────────────────────────────┐
               └──▶│      CONTENT SCANNER :3004            │
                   │  (Standalone file scanning service)   │
                   └──────────────────────────────────────┘
```
