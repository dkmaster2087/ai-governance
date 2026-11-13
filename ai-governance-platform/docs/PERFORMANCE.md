# Performance baseline

How much time Probaline's checks add to an AI request, and how many requests one gateway handles. Measured with
`scripts/load-test.mjs` against the stand-in model, so the model's own time is near zero and the numbers are
Probaline's.

## How to run it

```bash
GLOBAL_RATE_LIMIT=10000000 scripts/dev-local.sh start --postgres   # the per-address limit would stop the test
node scripts/load-test.mjs --seconds 30 --concurrency 1             # time added to one request
node scripts/load-test.mjs --seconds 30 --concurrency 20 --json out.json   # how much one gateway handles
```

Each scenario uses its own API key (a key allows 10,000 calls a minute). Run it against a deployed stage by
pointing `--gateway` and `--mock` at it, with the stand-in model reachable from the gateway.

## First results (2026-11-07)

**Where:** one MacBook (Apple M1, 8 cores), everything local. The services run from TypeScript source
(`ts-node-dev`), not the compiled images, and talk over mutual TLS; storage is PostgreSQL in Docker, with
secrets in the database. A deployed gateway runs compiled code on its own CPUs, so these numbers are a floor to
improve on, not a promise.

**One request at a time** (`--concurrency 1`):

| Scenario | p50 | p95 | p99 |
|---|---|---|---|
| The stand-in model directly | 0.1 ms | 0.1 ms | 0.2 ms |
| A clean prompt (rules, secrets, personal data, the model, case file) | 9.3 ms | 14.0 ms | 24.9 ms |
| A prompt with personal data, masked before the model | 9.0 ms | 13.8 ms | 24.7 ms |
| A prompt a rule stops (no model call) | 5.6 ms | 8.5 ms | 13.4 ms |
| An MCP tool call (arguments, rules, API call, result filtered, case file) | 9.0 ms | 12.5 ms | 22.1 ms |

So Probaline adds about **9 ms** to a typical request (**14 ms** at p95). Models take hundreds of milliseconds to
seconds to answer, so this is a small share of what people wait for.

**Twenty at a time** (`--concurrency 20`): one gateway process handled about **280 prompts a second**
(clean or with personal data), 340 stopped prompts a second, and 250 MCP calls a second, with no errors. At that
rate requests queue: p50 is about 65 ms and p95 about 120 ms. Production runs at least two gateways and adds more
on CPU (see `services-stack.ts`), so capacity grows with copies; the shared database's counters (rate limits,
alerts) are one write per request and weren't the limit here.

## After the request-path changes (2026-11-12)

Same machine and test as above, run against a gateway of its own on a laptop that was also running another full
local stack (load average around 15 on 8 cores), so these numbers are conservative. 20-at-once runs were 10 seconds
per scenario, so each test key stays under its 10,000 calls a minute.

| | Before | After |
|---|---|---|
| Time added, one request at a time (p50 / p95) | 8.4 / 11.7 ms | 3.1 / 9.2 ms |
| Clean prompts a second, 20 at once | 232 | 377–695 (three runs) |
| Prompts with personal data a second, 20 at once | 224 | 446–656 |
| Stopped prompts a second, 20 at once | 281 | 726–784 |
| MCP tool calls a second, 20 at once | 220 | 373–589 |
| p50 at 20 at once (clean prompts) | 81 ms | 26–46 ms |

What changed on the request path:

| Before, per AI request | Now |
|---|---|
| Company rules read from the database | Cached per gateway copy for 15 s (`HOT_CACHE_TTL_MS`); a change on this copy applies at once |
| Model settings read three times | Cached the same way (one read per company per 15 s) |
| API key "last used" written | At most once a minute per key per copy |
| Rate-limit counters written (per key, per company rule, per MCP caller) | Added up per copy and written once a second (`COUNTER_FLUSH_MS`); limits of 100 or less, and the last 10% of any limit, are still counted exactly on every call; calls already refused aren't written again |
| Alert and spend counters written (off the request path) | Written once a second; the write that crosses a threshold fires the alert, so each alert still fires once across all copies |
| Case file written to the database **and** one object per request to S3 | Database record still written before the answer (it's the evidence); the archive copy is batched into one gzipped JSON Lines file per company and day every 2 s (`ARCHIVE_FLUSH_MS`), retried on failure, and written on shutdown. If too much is waiting, requests wait for the archive rather than records being dropped |

Under load, a copy whose CPU is saturated (event loop more than 250 ms late, `SHED_LAG_MS`) or with 5,000 AI
requests already open (`SHED_MAX_OPEN`) answers new AI requests with `503 BUSY` and `Retry-After: 1` instead of
slowing everyone; dashboards and health checks stay up. In AWS the gateway now also scales on requests per copy
(6,000 a minute by default, CDK context `gatewayRequestsPerTarget`), not only CPU.

PostgreSQL installs delete expired records in chunks of 5,000, so a large cleanup never holds one long delete open.

## What to measure next

- The same runs against a deployed stage with the compiled images, on Fargate's CPU sizes, before the first
  customer; record them here with the task size.
- Large prompts (100 KB of code) through personal-data detection, the slowest check by design.
- Streaming answers: time to the first token.
