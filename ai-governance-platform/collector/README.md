# Probaline collector

Finds AI usage in logs a company already has and builds an AI usage assessment report, inside the company's
own environment. It is separate from the Probaline gateway and needs nothing else installed. Plan and roadmap:
[docs/ASSESSMENT.md](../docs/ASSESSMENT.md).

**Built:** the shared core; the AWS collector (Route 53 Resolver DNS query logs, Network Firewall logs,
CloudTrail for Amazon Bedrock and SageMaker); the on-premises collector (syslog from Palo Alto, Fortinet and any
CEF source such as Check Point; Squid, BIND and Windows DNS log files). **Not built yet:** Zscaler/Netskope,
Azure, Google Cloud, work apps, and sending results to a Probaline instance (`probaline` output).

## What it keeps

Only log lines that match a known AI service, as daily counts per service, source and caller. Everything else
is dropped as it is read. No raw log line, page address or content is stored.

- **Servers and workloads** keep the name the log gives them (instance ID, IP address, IAM role).
- **People** (IAM users, IAM Identity Center sign-ins, firewall and proxy user names) become codes such as
  `user-3f9a…`, made with a key generated on first run and kept in `private/`. `ACME\jdoe`, `jdoe` and
  `jdoe@acme.example` count as one person. The `private/` folder also holds the code-to-name lookup; it never
  leaves the customer's storage.

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
3. Deploy the template with the log bucket names, the code location, and in `Ignore` the Probaline gateway's own
   role (for example `role:probaline-gateway-task`) so Probaline doesn't report on itself.
4. Read the logs already there: run the `Backfill` command from the stack outputs. It is safe to run again.
5. The report is at `reports/latest.html` in the results bucket and is rebuilt daily.

Remove it with `aws cloudformation delete-stack`; the results bucket is kept until you empty and delete it.

Notes:
- CloudTrail records Bedrock model calls; depending on the API, some are data events that must be turned on
  for the trail.
- The template assumes the standard `aws` partition (not GovCloud or China).

## On-premises

One container receives syslog and follows log files. Build it and run it on any Linux host with Docker:

```bash
docker build -f collector/deploy/onprem/Dockerfile -t probaline-collector collector
docker compose -f collector/deploy/onprem/docker-compose.yml up -d
```

- **Syslog:** point firewalls and proxies at the host on port 514 (UDP or TCP; the container listens on 5514).
  One port takes every supported product at once; each line is recognized by its shape. Prefer TCP: UDP
  syslog drops messages when a device sends bursts faster than the host reads them.
- **Files:** mount DNS server and proxy log folders read-only under `/logs`. Files are followed as they grow,
  rotated files are read from the start, `.gz` files are read once, and positions survive restarts.
- **Results** are in the `/data` volume, same layout as above; `status.json` shows what is being received.
  The report is rebuilt daily (`REPORT_AT`, UTC), or on demand:
  `docker exec <container> node dist/cli.js report --out /data`.

| Product | How it arrives | What is read |
|---|---|---|
| Palo Alto Networks | syslog | URL filtering logs (THREAT, subtype url): source, user, URL |
| Fortinet FortiGate | syslog | web filter `hostname`, DNS `qname`, `srcip`, `user`, `sentbyte` |
| Check Point and others | syslog, CEF | `dhost` or `request`, `src`, `suser`, `rt`, `out` |
| Squid | file | native access log, including CONNECT |
| BIND | file or syslog | query log |
| Windows DNS | file | debug log (packet logging, US date order) |

Settings (environment): `SYSLOG_UDP_PORT`, `SYSLOG_TCP_PORT` (`off` to disable), `WATCH_DIR`, `FLUSH_SECONDS`
(default 300), `REPORT_AT` (default 05:30), `REPORT_DAYS`, `IGNORE`, `COMPANY`.

Syslog has no sender authentication; run the collector on a network the firewalls reach and nothing else does.

## Command line

The same collector runs on files, for logs exported from anywhere or for a quick look:

```bash
node collector/dist/cli.js collect --out ./assessment ./exported-logs/
node collector/dist/cli.js report --out ./assessment --days 30 --company "Acme"
```

`--reveal-names` builds a second copy with real names into `private/`.

## Demo data

```bash
node collector/scripts/sample-aws-logs.mjs ./sample-logs 21
node collector/scripts/sample-onprem-logs.mjs files ./sample-onprem 14
node collector/scripts/sample-onprem-logs.mjs send localhost 5514
```

Made-up AWS logs in the layout AWS uses; on-premises log files; or on-premises syslog sent over UDP.

## Tests

`npm test -w collector`: the catalog, AWS and on-premises parsers, privacy (pseudonyms, no raw lines, ignored
callers), findings, recommendations, report escaping, repeat-safe processing, and the on-premises server over
real UDP and TCP sockets and growing, rotated and compressed files.
