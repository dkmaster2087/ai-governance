# Enforcing that AI traffic goes through Probaline: plan

Status: streaming built (apps and proxy mode); the rest is planned. Written 2026-10-31.

## Why

A CISO buys Probaline to say: "AI only leaves our company through Probaline, and here is the proof." Today apps and IDEs
can be pointed at Probaline, but nothing stops them going direct, and some can't switch because Probaline doesn't
stream or doesn't speak their provider's format. Monitoring alone is easy to replace; enforcement isn't.

## The model: route, lock, verify

1. **Route:** make switching to Probaline a change of address, never a code change.
2. **Lock:** generate the rules that close every other path, in the tools the customer already runs. Probaline
   doesn't own their network or cloud; it writes the rules and they apply them.
3. **Verify:** the collectors keep measuring, so the customer sees the share of AI traffic going through Probaline
   and every direct path still open.

## 1. Route

| Gap | What to build |
|---|---|
| No streaming | Server-sent events on `/v1/chat/completions` (`stream: true`), with checks on the way in and personal-data masking on the stream out. Streaming pass-through in proxy mode for IDEs. |
| Only the OpenAI format | Anthropic-native `POST /v1/messages`; a Bedrock-compatible endpoint (`/model/{id}/invoke`, `/converse`) so AWS SDK apps switch by endpoint; Azure OpenAI-style paths. |
| Switching takes effort | Setup kits: environment variables per SDK (`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`), a Kubernetes mutating webhook that injects them, and a PAC file for IDEs through the corporate proxy. |

### Streaming design

- Policy checks and prompt masking run before anything is sent, as today. A blocked request never starts a
  stream.
- The answer streams back in the OpenAI `chat.completion.chunk` format and ends with `data: [DONE]`.
- **Masking on the way out:** the gateway holds back a short tail of text (enough for the longest pattern it
  masks) and scans before releasing it, so a phone number split across chunks is still caught. The in-process
  scanner is used for streams; the data-protection service is too slow to call per chunk.
- The audit record is written when the stream ends, with token counts, and records if the client went away
  early.
- Proxy mode streams the provider's bytes straight through after the request check; it already doesn't mask.

## 2. Lock

All locks start in **report-only** mode: the customer sees what would be blocked before anything is.

| Layer | What Probaline generates |
|---|---|
| AWS | An organization-wide policy (SCP) denying `bedrock:InvokeModel*`, `bedrock:Converse*` and `sagemaker:InvokeEndpoint*` to everyone but the Probaline gateway role; VPC endpoint policies to match. |
| Azure | Azure Policy and role assignments limiting Azure OpenAI / AI Foundry data-plane access to the gateway's identity; private endpoints. |
| Google Cloud | Organization policy and VPC Service Controls around Vertex AI, allowing only the gateway's service account. |
| Firewalls and web gateways | A live feed of AI service domains from the collector catalog, in the formats they consume: Palo Alto External Dynamic List, FortiGate external threat feed, Zscaler and Netskope custom URL categories, DNS RPZ zone. The rule: block these except from the gateway's egress addresses. |
| Browsers | The extension blocks unapproved tools and points to approved ones (built). |

Not planned: faking provider certificates to intercept TLS. Web gateways already do this; partner instead.

## 3. Verify

- The collectors add **"share of AI traffic through Probaline"**: gateway requests compared with direct calls they
  still see, per source.
- A list of every server, app or identity still going direct, each with the fix.
- A trend from the first assessment onward, for the CISO's board report.

## Order

| # | Item | Size |
|---|---|---|
| 1 | Streaming (apps and proxy mode): **built** | 1 week |
| 2 | AI domain feed for firewalls, and generated AWS lock policies | 1 week |
| 3 | "Share through Probaline" in collector reports | 3–4 days |
| 4 | Anthropic-native and Bedrock-compatible endpoints | 1–2 weeks |
| 5 | Setup kits (env vars, Kubernetes webhook, PAC) | 1 week |
| 6 | Azure and Google Cloud lock policies | 1 week, with their collectors |

## Risks

- **Breaking apps on day one.** Report-only first; every lock comes with the list of what it would block.
- **Streaming masks only what patterns catch.** The deeper data-protection check can't run per chunk; the
  report and docs say so.
- **Latency.** Holding back a short tail adds a few milliseconds to each chunk; the first token isn't delayed
  beyond the request checks.
