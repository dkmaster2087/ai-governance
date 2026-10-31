# AI usage assessment and collectors: plan

Status: phases 0–2 built (the shared core, the AWS collector and the on-premises collector, in
[collector/](../collector/README.md)); the rest is planned. Written 2026-10-31.

## The idea

Before a customer installs Aegis, we show them how AI is already used across their environment: which AI
services, from which servers, apps and people, how often, and how much of it goes around any control. Then we
recommend which of that traffic should go through Aegis so policies can be enforced.

This is how we get in the door. A read-only assessment is easy for a CISO to approve, produces a report they
can't get elsewhere, and ends in a concrete proposal. After they buy, the same collectors keep running as
continuous shadow-AI monitoring.

## Decisions

1. **Collectors are a separate, small product.** They are not part of any Aegis installation, and an
   assessment needs nothing else installed: no gateway, no dashboard, no database.
2. **Raw logs never leave the customer's environment.** Collectors read logs where they already are, keep only
   lines that match known AI services, and turn them into counts.
3. **Local-only is the default.** The assessment report is built inside the customer's environment. Nothing is
   sent to us unless they choose to send it.
4. **One collector design, many sources.** Each source (AWS, Azure, Google Cloud, firewalls, security gateways,
   work apps) is a small parser feeding one common format, so the report and recommendations don't change
   with the source.
5. **Read-only and removable.** Collectors get read-only access, change nothing in the traffic path, and come
   out with one command when the assessment ends.

## Three installation models, one collector

| | Cloud | Hybrid | Self-hosted |
|---|---|---|---|
| Gateway, policy engine, data protection | Our AWS | Customer | Customer (their AWS today; on-premises and Kubernetes planned) |
| Dashboard, rules, licenses | Our AWS | Our AWS | Customer |
| Prompts and evidence | Our AWS | Customer | Customer |
| Collectors send results to | Our cloud | Customer's data plane, which reports counts to us | The customer's own Aegis |
| Status | Available | Planned ([HYBRID.md](HYBRID.md)) | Available on AWS |

The collector is the same in every column. Only its **output** setting changes:

- `local`: write results and the report to storage in the customer's environment. Used for assessments.
- `aegis`: send results to an Aegis instance: ours, a hybrid data plane, or a self-hosted install.

Moving from an assessment to a paying customer means changing that one setting, not reinstalling anything.

In code today the tenant field `deploymentMode` has `saas` and `onprem` (shown as "Their AWS"). Hybrid adds a
third value; `onprem` should be renamed `self_hosted` when that happens.

## How an assessment runs

1. **Agree on scope:** which clouds, which firewalls or security gateways, and which work apps. 30 minutes with
   their security and network teams.
2. **Install collectors.** Each is one template or one container (see Packaging), run by the customer's own
   team with read-only access. Typically under an hour per source.
3. **Collect for two to four weeks.** Nothing to watch. A health page in the local report shows each source
   is being read.
4. **Build the report locally.** The collector writes an HTML report to the customer's storage. Their security
   team reads it first.
5. **Review together.** They share the report with us, screen-share it, or send us only the summary. Their
   choice; we never receive anything automatically in local mode.
6. **Remove or keep.** Delete the collectors, or switch their output to `aegis` once Aegis is installed.

### What stays private, even in the report

- **No content.** Logs show which service was contacted, not what was sent. Traffic is encrypted.
- **No raw log lines.** Only counts per service, source and day.
- **People are pseudonymous by default.** User names, emails and device names are replaced with a keyed hash.
  The key is generated in the customer's environment and never leaves it. Their team can reveal names
  locally; we only see `user-3f9a…`.
- **Servers are named only as specifically as the logs allow:** a hostname, instance ID or subnet.

For companies that won't share even that, the local report is the whole assessment: we walk through it on a
call, and nothing is ever transferred.

## The common format

Every parser produces sightings like this. It is the same shape the browser extension already sends to
`POST /v1/shadow-ai/events`, plus a count.

| Field | Example | Notes |
|---|---|---|
| `day` | `2026-11-03` | Counts are per day |
| `service` | `openai-api` | From the AI service catalog |
| `domain` | `api.openai.com` | |
| `kind` | `api`, `browser`, `cloud_ai` | API call, person in a browser, or the cloud's own AI service |
| `who` | `host:ip-10-0-3-12`, `user:3f9a…` | Pseudonymous by default |
| `source` | `aws_dns`, `zscaler`, `m365` | Which log it came from |
| `count` | `412` | Lookups or requests that day |
| `bytesOut` | `1830221` | When the log has it; shows data volume going out |

### The AI service catalog

The collectors' list of AI services grows from today's ten browser tools to a few hundred, each with:

- domains and API endpoints, including cloud AI endpoints (`bedrock-runtime.*.amazonaws.com`,
  `*.openai.azure.com`, `*-aiplatform.googleapis.com`, `generativelanguage.googleapis.com`)
- a category: chat app, model API, coding assistant, cloud AI service, or AI inside a work app
- whether the vendor offers business data terms (no training on customer data)

The catalog is versioned and shipped with the collector, so it works offline. The gateway's
`services/gateway/src/services/ai-tools.ts` becomes a generated subset of it.

## Sources, in build order

| # | Source | What it shows | Where the collector runs |
|---|---|---|---|
| 0 | Core (**built**) | Common format, catalog, pseudonymizing, local report | Shared library |
| 1 | AWS (**built**) | Route 53 Resolver DNS logs (which servers look up AI services), Network Firewall logs, CloudTrail for Bedrock and SageMaker called directly | Lambda in their account, reading their S3 or CloudWatch logs |
| 2 | On-premises (**built**) | Syslog from firewalls and proxies (Palo Alto, Fortinet, Check Point, Squid), DNS server logs (BIND, Windows DNS) | One container on any Linux host or Kubernetes cluster |
| 3 | Security gateway | Zscaler or Netskope logs: covers laptops wherever they are | Same container, or a Lambda reading their log export |
| 4 | Azure and Google Cloud | Azure: DNS and Azure Firewall logs, Azure OpenAI / AI Foundry usage from Azure Monitor. Google Cloud: Cloud DNS logs, Cloud NGFW / Secure Web Proxy, Cloud Audit Logs for Vertex AI and the Gemini API | Azure Function; Cloud Run job |
| 5 | Work apps | Microsoft 365 audit logs (Copilot), Google Workspace reports (Gemini), Okta and Entra sign-ins to AI tools | Any of the above, using read-only API access |
| 6 | On request | Oracle Cloud, Alibaba Cloud, Snowflake Cortex and Databricks usage, Cloudflare One, Cisco Umbrella | Per source |

Phase 0 and the on-premises container are written once; every later source is a parser plus a deployment
template.

## Packaging

| Where | Package | Access it needs |
|---|---|---|
| AWS | CloudFormation template: one Lambda, one S3 bucket for results and report | Read on the chosen log buckets and CloudTrail; nothing else |
| Azure | Bicep template: one Function app | Log Analytics Reader on the chosen workspaces |
| Google Cloud | Terraform module: one Cloud Run job | Logs Viewer on the chosen projects |
| On-premises | One container image (Docker or Kubernetes), signed | A syslog port and/or read access to log files |

All collectors share one TypeScript core, the same language as the rest of Aegis. The core stores results
through a small interface (a folder, or S3 today), so Azure Blob and Google Cloud Storage are small additions. Each template takes the same
settings: sources, output (`local` or `aegis`), and for `aegis` the address and a key with a new
`discovery:ingest` permission.

## The report

1. **Headline:** "In the last 21 days, 46 servers and about 310 people used 23 AI services. 9 of those have no
   business data terms."
2. **By service:** volume, trend, kind, and whether it is approved, unknown or risky.
3. **Apps and servers calling AI directly:** each with the services it calls and how often. These are the
   easiest to route through Aegis.
4. **People in browsers:** which tools, how many people, which departments (if the logs carry them).
5. **Cloud AI services used directly:** Bedrock, Azure OpenAI, Vertex AI calls that no gateway sees.
6. **Coverage:** which sources were read, for how long, and what they can't see (for example, encrypted DNS
   in browsers, or traffic not logged at all).
7. **Recommendations** (below).

## Recommendations

Each finding maps to one concrete action:

| Finding | Recommendation | Effort for them |
|---|---|---|
| A server or app calls a model API directly | Route it through Aegis: change its base address to the gateway | One configuration change per app |
| Bedrock, Azure OpenAI or Vertex AI called directly | Put it behind the gateway; restrict direct access with cloud permissions | Small, per account |
| People use unapproved chat tools | Approve one tool, block or steer away from the rest with the extension | Policy decision plus extension rollout |
| AI tools with no business data terms | Block them | Extension or security gateway rule |
| Copilot or Gemini inside work apps | Usually approved already; confirm data settings in the vendor's admin console | Review |

The report estimates coverage: "Routing these 12 apps through Aegis puts 78% of AI API traffic under policy."

## Not in scope

- **Reading content.** Collectors never decrypt traffic. Seeing what is sent is what the gateway is for.
- **Endpoint agents** on laptops. Security gateways and the browser extension cover laptops without one.
- **Blocking.** Collectors are read-only. Blocking stays with the extension, the security gateway or firewall,
  and cloud permissions.

## Rough size

| Phase | Size |
|---|---|
| 0. Core: format, catalog, pseudonymizing, local report | 2 weeks |
| 1. AWS collector and template | 1 week |
| 2. On-premises container with syslog and file parsers | 1–2 weeks |
| 3. Zscaler or Netskope | 1 week each |
| 4. Azure and Google Cloud | 1 week each |
| 5. Microsoft 365, Google Workspace, Okta/Entra | 1 week |

About two months to cover AWS, on-premises and one security gateway, which is enough to run a first
assessment.

## Open questions

- **Name and price.** A free time-boxed assessment, or a paid one credited against the first year?
- **Catalog upkeep.** New AI services appear weekly. Who reviews additions, and how often do collectors update?
- **Mapping DNS to people.** DNS logs show device addresses. Mapping them to users needs DHCP or directory
  logs; offer it as an option, off by default.
- **Air-gapped sites.** The local mode already works offline; catalog updates would be delivered as files.
