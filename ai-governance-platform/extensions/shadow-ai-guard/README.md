# Aegis AI — Shadow AI Guard (Chrome Extension)

Browser extension that detects and blocks unauthorized AI tool usage, managed per-tenant from the Aegis AI governance platform.

## Install (Development)

1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select this `shadow-ai-guard` folder

## Configure

1. Click the extension icon in the toolbar
2. Enter your Tenant ID (from the governance dashboard)
3. Set mode: **Monitor** (log only) or **Block** (redirect)
4. Set Gateway URL (default: `http://localhost:3000`)
5. Click "Save & Apply"

## How it works

- **Monitor mode**: Logs attempts to access AI tools (OpenAI, Claude, Gemini, etc.) without blocking. Events appear in the Shadow AI dashboard.
- **Block mode**: Redirects requests to blocked AI domains to a governance page. Events are still logged.

## Monitored domains

- api.openai.com, chat.openai.com
- api.anthropic.com, claude.ai
- bard.google.com, gemini.google.com
- perplexity.ai
- api.cohere.ai, api.mistral.ai
- api.together.ai, api.groq.com
- api-inference.huggingface.co
- api.replicate.com

## Tenant configuration

Admins can customize per-tenant:
- Which domains to block vs allow
- Block or monitor mode
- Custom allowed domains (e.g., Azure OpenAI for specific tenants)
- Sync interval for config updates

Config syncs from the governance platform every 5 minutes.
