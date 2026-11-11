# Probaline collector

Finds AI usage in logs a company already has and builds an AI usage assessment report, inside the company's
own environment. It is separate from the Probaline gateway and needs nothing else installed. Plan and roadmap:
[docs/ASSESSMENT.md](../docs/ASSESSMENT.md).

**Built:** the shared core; the AWS collector (Route 53 Resolver DNS query logs, Network Firewall logs,
CloudTrail for Amazon Bedrock and SageMaker); the on-premises collector (syslog from Palo Alto, Fortinet and any
CEF or LEEF source such as Check Point; Squid, BIND and Windows DNS log files); Zscaler and Netskope (beta:
tested on made-up logs in their documented formats, not yet on a customer's). **Not built yet:** Azure, Google
Cloud and work apps (beta, below), and sending results to a Probaline instance (`probaline` output).

## What it keeps

Only log lines that match a known AI service, as daily counts per service, source and caller. Everything else
is dropped as it is read. No raw log line, page address or content is stored.

- **Servers and workloads** keep the name the log gives them (instance ID, IP address, IAM role).
- **People** (IAM users, IAM Identity Center sign-ins, firewall and proxy user names) become codes such as
  `user-3f9a…`, made with a key generated on first run and kept in `private/`. `ACME\jdoe`, `jdoe` and
  `jdoe@acme.example` count as one person. The `private/` folder also holds the code-to-name lookup; it never
  leaves the customer's storage.

## Share through Probaline

The report opens with the share of AI traffic that goes through Probaline, per path: apps calling model APIs,
and cloud AI services (Bedrock, SageMaker, Azure OpenAI, Vertex AI). Name the Probaline gateway and connector
with `--gateway` (or `GATEWAY` in the deployed collectors), as `type:value`, comma separated:

- `role:probaline-gateway-task` for the gateway's role in CloudTrail
- `ip:203.0.113.4`, or a range such as `ip:203.0.113.0/28`, for its outbound addresses in DNS and firewall logs
- `host:gw-*` for hosts by name (a trailing `*` matches the start)

Their traffic is counted as through Probaline and compared with everything else **in the same log**, so the
share is in one unit (DNS lookups, firewall connections or CloudTrail calls), never a mix. Each path lists the
callers still going direct, with the fix. Each report's findings file keeps the shares, so later reports show
the earlier ones (the last six). Browser use isn't a path here: the browser extension governs it.

`--ignore` (`IGNORE`) still leaves other known-good callers out entirely. Use `--gateway` for Probaline itself:
ignoring it hides the traffic that proves the share.

The list of AI services is the shared Probaline catalog (`shared/catalog`), the same one the gateway's Shadow
AI page uses; the report says which version it used.

## Results layout

```
sightings/<day>/<batch>.jsonl    daily counts; one file per input log file and day (re-reading a file replaces it)
reports/latest.html              the shareable report (pseudonymous)
reports/report-<day>.html        a dated copy
reports/findings-<day>.json      the same findings as data
private/pseudonym.key            the key behind the codes
private/names.json               code → name lookup, for the customer's team only
private/report-with-names-*.html a copy with real names, only if built with --reveal-names
```

## AWS

`deploy/aws/collector.yaml` creates one Lambda function, one encrypted results bucket, a rule that runs the
function when a new log file lands, and a daily schedule that rebuilds the report. The function can read the
log buckets you name and write only to its own bucket. It sends nothing out of the account.

1. Build the code package: `npm run bundle:lambda -w collector` → `collector/probaline-collector-aws.zip`, and
   upload it to a bucket in the account.
2. Turn on **Send notifications to Amazon EventBridge** for each log bucket.
3. Deploy the template with the log bucket names, the code location, and in `Gateway` the Probaline gateway's
   own role (for example `role:probaline-gateway-task`), so its traffic counts as through Probaline.
4. Read the logs already there: run the `Backfill` command from the stack outputs. It is safe to run again.
5. The report is at `reports/latest.html` in the results bucket and is rebuilt daily.

Remove it with `aws cloudformation delete-stack`; the results bucket is kept until you empty and delete it.

Notes:
- CloudTrail records Bedrock model calls; depending on the API, some are data events that must be turned on
  for the trail.
- The template assumes the standard `aws` partition (not GovCloud or China).

## On-premises

One container receives syslog and follows log files. Run it on any Linux host with Docker:

```bash
docker compose -f collector/deploy/onprem/docker-compose.yml up -d
```

The image is `probaline/collector:<version>`: the collector compiled to bytecode on a minimal (distroless)
Node image, with no shell or source, running as a non-root user, signed with a bill of materials (see
[Releases](#releases)). To build it yourself: `docker build -f collector/Dockerfile -t probaline/collector:0.1.0 .`
from the platform folder.

- **Syslog:** point firewalls and proxies at the host on port 514 (UDP or TCP; the container listens on 5514).
  One port takes every supported product at once; each line is recognized by its shape. Prefer TCP: UDP
  syslog drops messages when a device sends bursts faster than the host reads them.
- **Files:** mount DNS server and proxy log folders read-only under `/logs`. Files are followed as they grow,
  rotated files are read from the start, `.gz` files are read once, and positions survive restarts.
- **Results** are in the `/data` volume, same layout as above; `status.json` shows what is being received.
  The report is rebuilt daily (`REPORT_AT`, UTC), or on demand:
  `docker exec <container> /nodejs/bin/node /app/loader.js report --out /data`.

| Product | How it arrives | What is read |
|---|---|---|
| Palo Alto Networks | syslog | URL filtering logs (THREAT, subtype url): source, user, URL |
| Fortinet FortiGate | syslog | web filter `hostname`, DNS `qname`, `srcip`, `user`, `sentbyte` |
| Check Point and others | syslog, CEF | `dhost` or `request`, `src`, `suser`, `rt`, `out` |
| Squid | file | native access log, including CONNECT |
| BIND | file or syslog | query log |
| Windows DNS | file | debug log (packet logging, US date order) |

Settings (environment): `SYSLOG_UDP_PORT`, `SYSLOG_TCP_PORT` (`off` to disable), `WATCH_DIR`, `FLUSH_SECONDS`
(default 300), `REPORT_AT` (default 05:30), `REPORT_DAYS`, `GATEWAY`, `IGNORE`, `COMPANY`.

Syslog has no sender authentication; run the collector on a network the firewalls reach and nothing else does.

## Command line

The same collector runs on files, for logs exported from anywhere or for a quick look:

```bash
node collector/dist/cli.js collect --out ./assessment --gateway role:probaline-gateway-task ./exported-logs/
node collector/dist/cli.js report --out ./assessment --days 30 --company "Acme"
```

`--reveal-names` builds a second copy with real names into `private/`.

## Your APIs behind Probaline (beta)

Shows how many calls to the company's own APIs (the ones behind Probaline MCP servers) came through Probaline,
and who called them directly. Download the API list from the dashboard (Enforcement → Your APIs → *Download API
list for the collector*: hosts and base paths, and the gateway's outbound addresses) and give it to `collect`
with the APIs' access logs:

```bash
node collector/dist/cli.js collect --out ./assessment --gateway ip:10.0.5.4 probaline-apis.json ./api-logs/
```

| Log | Format read | Caller |
|---|---|---|
| AWS Application Load Balancer | The standard access log (S3, plain or .gz) | Client address |
| Amazon API Gateway | JSON access logs with `sourceIp`, `domainName`, `httpMethod`, `path` (or `routeKey`), `requestTimeEpoch`, `userAgent` | `sourceIp` |
| nginx | `combined`, or with `$host` first (`vhost_combined`) | Remote address |
| Envoy | The default access log format | First `X-Forwarded-For` address |

Calls from the gateway's addresses count as through Probaline; add connector hosts with `--gateway`. Everything
else is direct, listed by caller and what made it (Claude, ChatGPT, Cursor, a Python or Node script, curl). A
call that says it is Probaline (`Probaline-MCP` user agent) from another address is flagged. The report adds the
path to "Share through Probaline", a table per API, and a recommendation to lock the APIs.

## MCP servers on laptops (beta)

`endpoint/mcp-scan.sh` (macOS) and `endpoint/mcp-scan.ps1` (Windows) list the MCP servers people set up in
Claude Desktop, Claude Code, Cursor, VS Code and Windsurf. Run them through device management (Jamf, Kandji,
Intune; as root or SYSTEM they scan every account), collect the output files, and give them to `collect` with
the other logs: they are recognized by content.

They are read-only and print only the app, the server's name, local program or remote URL, the program's name
and package (`npx @modelcontextprotocol/server-github`, a Docker image), or the URL's host, and whether the
server is given credentials of its own. Never environment values, header values, other arguments, or anything
after a URL's host. People and laptop names become codes like every other source.

The report gets a section "MCP servers on laptops" and a recommendation to offer them through Probaline;
`report --company-domains acme.com,acme.internal` marks servers that reach the company's own systems (private
addresses always count). The shell script is tested on macOS against fixture settings with secrets planted in
every field; the PowerShell script isn't yet tested on Windows.

## Zscaler and Netskope (beta)

Both see laptops wherever they are, which firewall and DNS logs miss once people leave the office. They use
the same on-premises container (or the AWS collector, for logs streamed into S3); nothing new to install.

| Product | Send it as | Formats read |
|---|---|---|
| Zscaler Internet Access | An NSS web log feed to the container over TCP syslog (port 5514) | JSON (also wrapped as Splunk HEC), LEEF (QRadar), key=value (Splunk), CEF (ArcSight). Fields used: `hostname` or `url`, `login`, `cip`, `epochtime` or `datetime`, `requestsize` |
| Netskope | Cloud Log Shipper to the container over syslog, as JSON or CEF | Page and application events: `domain` or `url`, `ur_normalized` or `user`, `srcip`, `timestamp`, `client_bytes` |
| Netskope | Log streaming of transaction events to a folder the container watches, or to an S3 bucket the AWS collector reads | CSV with a header row, or W3C with a `#Fields:` line, plain or `.gz`. Columns used: `cs-host` or `cs-uri`, `cs-username`, `c-ip`, `date` + `time`, `cs-bytes` |

Use TCP for Zscaler NSS: a busy feed over UDP drops lines. Files with a header row are read with that header,
and the header is remembered while a file is followed, including across restarts. Zscaler and Netskope lines
sent as CEF are labelled with their product in the report.

## Azure and Google Cloud (beta)

The parsers read the records each cloud exports, wherever they end up: in the cloud's own storage (read by the
in-cloud job below), copied to a folder (the CLI or the on-premises container), or relayed over syslog.

| Cloud | Logs | Turn on |
|---|---|---|
| Azure | Azure Firewall application rule and DNS proxy logs (resource-specific `AZFW…` or legacy) | Diagnostic setting on the firewall → storage account |
| Azure | DNS security policy query logs | Diagnostic setting → storage account |
| Azure | Azure OpenAI / AI Foundry request logs (`RequestResponse`): model calls by person (Entra sign-in), app ID, or IP | Diagnostic setting on each Azure OpenAI / AI Services resource |
| Google Cloud | Cloud DNS query logs (by VM) | DNS logging on the network's DNS policy; sink to Cloud Storage |
| Google Cloud | Secure Web Proxy logs | Sink to Cloud Storage |
| Google Cloud | Data Access audit logs for Vertex AI and the Gemini API: model calls by service account or person | Turn on Data Access logs for `aiplatform.googleapis.com` and `generativelanguage.googleapis.com`; sink to Cloud Storage |

### In-cloud job

`probaline-collector cloud-job` (same container image) reads new or changed log files from the cloud's
storage, keeps AI matches, and rebuilds the report in a results container or bucket of the customer's. It signs
in with the platform's workload identity, so there are no keys. Re-reading a file (Azure appends to the hour's
file) replaces its results.

- **Azure:** `deploy/azure/collector.bicep` creates a scheduled Container Apps job with a managed identity
  (Storage Blob Data Reader on the log account, Contributor on a new private results account).
  `az deployment group create -g <rg> -f collector/deploy/azure/collector.bicep -p logStorageAccountName=<account> image=<image>`
- **Google Cloud:** `deploy/gcp/deploy.sh` creates a service account, a private results bucket, the Cloud Run
  job and an hourly Cloud Scheduler trigger; `CREATE_SINKS=1` also creates the three log sinks.

Settings: `CLOUD` (`azure` or `gcp`); Azure `LOG_ACCOUNT_URL`, `LOG_CONTAINERS`, `RESULTS_ACCOUNT_URL`,
`RESULTS_CONTAINER`; Google Cloud `LOG_BUCKETS`, `RESULTS_BUCKET`; common `LOG_PREFIXES`, `GATEWAY`, `IGNORE`,
`REPORT_DAYS`, `COMPANY`, `MAX_FILES`.

**Status:** the parsers follow the documented formats and the job is tested against local stand-ins (Azurite
for Blob Storage, fake-gcs-server for Cloud Storage). Neither has run in a real Azure subscription or Google
Cloud project yet, and the Bicep template hasn't been compiled or deployed (the Bicep tools don't run on the
machine this was built on). Treat the deployment files as a starting point.

Testing against the stand-ins:

```bash
docker run -d -p 10000:10000 mcr.microsoft.com/azure-storage/azurite:3.33.0 azurite-blob --blobHost 0.0.0.0
docker run -d -p 4443:4443 fsouza/fake-gcs-server:1.52.2 -scheme http -port 4443
AZURITE_CONNECTION_STRING="<Azurite's documented development connection string>" GCS_TEST_ENDPOINT=http://localhost:4443 npx jest cloud-job
```

## Work apps and identity providers (beta)

Sign-in and audit logs show AI use that never touches a firewall: people signing in to AI apps, using Copilot or
Gemini inside the apps the company already pays for, and letting AI apps reach company data. These logs name
*apps*, not web addresses, so the catalog also knows the names identity providers use ("ChatGPT Enterprise",
"Claude for Work", "GitHub Copilot"). A name must start with a known app name word for word.

| Source | Records | Shows |
|---|---|---|
| Microsoft 365 | Unified audit log (`CopilotInteraction`, `AIAppInteraction`): Management Activity API content, Sentinel, or a Purview audit search CSV export | Copilot use per person and app; other AI apps Purview watches |
| Google Workspace | Reports API activity (`token`, `saml`, Gemini) | Gemini use; **AI apps given access to Drive or Gmail** with OAuth; SSO to AI apps |
| Okta | System Log (`user.authentication.sso`, OAuth consent grants) | Sign-ins and consent to AI apps |
| Microsoft Entra ID | Sign-in logs (Graph or a diagnostic setting) and audit logs (`Consent to application`) | Sign-ins to AI apps; people letting AI apps reach company data |
| Any other identity provider | A CSV or JSON sign-in export with columns for user, app and (optionally) time and result | OneLogin, Ping, JumpCloud, Duo, Auth0, ADFS through a SIEM, … |

Give the collector the exported files (`collect`, the container's watch folder, or an S3 / Blob / Cloud Storage
bucket the in-cloud job reads). Failed sign-ins are skipped. **Not built yet:** pulling these logs directly
from each product's API with read-only credentials; today they come from exports, a SIEM, or a diagnostic
setting (Entra).

## Releases

Set the new version in `package.json` and `COLLECTOR_VERSION` in `src/cli.ts`, then push a tag
`collector-v<version>`. The Release workflow (`.github/workflows/release-agents.yml`) checks the versions
agree, builds the image, checks nothing readable is in it, and publishes it signed as
`probaline/collector:<version>` and `ghcr.io/dkmaster2087/probaline-collector:<version>`. Check an image with
`cosign verify` as described in the connector's README.

## Demo data

```bash
node collector/scripts/sample-aws-logs.mjs ./sample-logs 21
node collector/scripts/sample-onprem-logs.mjs files ./sample-onprem 14
node collector/scripts/sample-onprem-logs.mjs send localhost 5514
node collector/scripts/sample-sse-logs.mjs files ./sample-sse 14
node collector/scripts/sample-cloud-logs.mjs ./sample-cloud 7
node collector/scripts/sample-workapp-logs.mjs ./sample-workapps 14
node collector/scripts/sample-api-logs.mjs ./probaline-apis.json ./sample-api-logs 21
```

Made-up AWS logs in the layout AWS uses; on-premises log files; on-premises syslog sent over UDP; Zscaler
and Netskope logs in their feed formats; or Azure and Google Cloud logs laid out as each cloud writes them.

## Tests

`npm test -w collector`: the catalog, AWS, on-premises, Zscaler, Netskope, Azure and Google Cloud parsers, the
in-cloud job, privacy (pseudonyms, no raw lines, ignored
callers), the share through Probaline (gateway by role, IP range and host; trend across reports), the laptop MCP scan
(no secret reaches the output, the store or the report), findings, recommendations, report escaping, repeat-safe processing, and the on-premises server over
real UDP and TCP sockets and growing, rotated and compressed files.
