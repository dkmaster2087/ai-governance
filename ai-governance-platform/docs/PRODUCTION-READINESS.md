# Production readiness: review and plan

Written 2026-11-07, from a review of every feature's workflow end to end: each dashboard page's calls against
the gateway's routes, each service's settings against what the AWS deployment provides, each page's data
loaded live as a company admin and as the platform admin, and the deploy, CI and security setup.

## What works

- Every dashboard page's data loads, for company admins and platform admins (27 endpoints checked live).
- Every dashboard call has a matching gateway route.
- The request path (keys, rules, secrets, personal data, the model, case files), IDE proxy mode, streaming,
  MCP servers (both phases), licensing, compliance frameworks and analytics pass 36 end-to-end scenarios on
  DynamoDB and PostgreSQL.
- Settings the services read are set by the deployment, or have safe defaults.

## What's wrong

### A. Blockers: production can't be used as it stands

| # | Problem | Impact | Fix | Size |
|---|---|---|---|---|
| A1 | **The dashboard and docs site are never deployed.** The deploy workflow only uploads the sales website; no stack hosts the dashboard. The dashboard calls `/api/…` on its own address, which only the local dev server forwards. | No customer can use the product. | A frontend stack: S3 + CloudFront for the website, dashboard (e.g. `app.`) and docs; on the dashboard's distribution, `/api/*` goes to the gateway's load balancer. Deploy all three from the workflow. | 2–3 days |
| A2 | **Production builds don't get their settings.** The website has no `VITE_API_URL`/`VITE_DASHBOARD_URL` (its contact form and sign-in links point at `localhost`). The dashboard has no Cognito pool/client IDs, `VITE_AUTH_MODE` or `VITE_GATEWAY_PUBLIC_URL`. | Sign-in and the website's links don't work. | Pass them from stack outputs in the deploy workflow; fail the build if missing outside dev. | ½ day |
| A3 | **No way to create users in production.** User management works only in development mode (accounts in the browser). Creating a company doesn't create its first admin in Cognito. | Nobody can sign in to a new company. | A users API on the gateway using Cognito admin calls (invite with role and company, list, change role, disable, delete); creating a company invites its first admin; the Users page uses it. | 2–3 days |
| A4 | **First deploy to a new account fails**: images are pushed before CDK creates their repositories. | A fresh environment can't be created from the workflow. | Create the repositories in their own stack deployed first (or have CDK build the images). | ½ day |
| A5 | **The on-premises reporting agent can't report.** It reads usage from the local gateway with the development login (`Bearer test-key`), which production refuses, expects fields that endpoint doesn't return, and that endpoint now only serves signed-in users. It would quietly report zeros. | On-prem customers send no usage. | The agent reads its summaries through a dedicated, license-key-authenticated analytics endpoint, returning exactly what it sends. | 1–2 days |
| A6 | **The API stack is a leftover scaffold**: an API Gateway answering every request with a fake 200, wired to nothing. | Misleading, costs money, an extra public endpoint. | Remove it. | ½ hour |

### B. Security settings

| # | Problem | Fix | Size |
|---|---|---|---|
| B1 | **CORS allows any website** (with credentials) when `ALLOWED_ORIGINS` is empty, which it is in the AWS deployment. | Set it from the dashboard's address in CDK; refuse to start in production with no origins set. | ½ day |
| B2 | **No web firewall** in front of the public load balancer. | AWS WAF with managed rule sets and a per-address rate rule. | ½ day |
| B3 | **Policy engine and data protection accept requests from anything in the network.** Only analytics checks a signed request from the gateway. | Use the same signed internal token for both. | 1 day |
| B4 | **Per-key rate limits are stored (60 a minute) but not enforced**; only a per-address limit applies. MCP limits are per instance. | Enforce per key and per MCP caller with shared counters (as the policy engine's rate rule now does). | 1 day |
| B5 | **Provider keys and MCP credentials use the default Secrets Manager key**, not the platform's KMS key (`PROVIDER_KEYS_KMS_KEY_ID` is unset). | Pass the storage stack's key and grant its use. | ½ day |
| B6 | **The MCP signing key never rotates.** | Rotation with two published keys during the overlap. | 1 day |

### C. Features that look built but don't work

| # | Problem | Fix | Size |
|---|---|---|---|
| C1 | **Audit records are never deleted.** No expiry is set, so the retention period each case file shows ("kept until …") isn't applied. | Set each record's expiry from the company's retention; an S3 lifecycle rule for the archive; a legal-hold switch. | 1 day |
| C2 | **Alerts never fire.** The alerting service is never called; alert rules exist only through the API; there's no alerts page. | Call it from the request path (stop spikes, personal data in answers, shadow AI, spend); deliver by webhook and email; an Alerts page. | 3–4 days |
| C3 | **CloudWatch alarms watch metrics nothing publishes** (policy violations, latency, circuit breaker) **and notify nobody.** | Publish those metrics from the gateway (embedded metric format); an SNS topic with an operator email. | 1 day |
| C4 | **Settings stored but never applied**: per-company `maxRequestsPerMinute`, `maxTokensPerRequest`, `piiMaskingEnabled`, `allowExternalProviders`, `dataResidencyRegion`; per-model "allowed for roles/apps", "requires approval", token limit. None appear in the dashboard. | Enforce per-model role/app limits and token limits; remove the rest. | 1–2 days |
| C5 | **The website's contact form tells nobody**: submissions go to a file in the audit bucket. | Email the team (SES) and keep the copy. | ½ day |
| C6 | **The activity trail and log export** (built in another session) sit on branch `claude/jolly-jemison-6ca103`, and their AWS tables aren't in the deployment. | Merge, add the tables and grants, rerun the end-to-end suite. | 1 day |
| C7 | **The connector and collector images aren't published**, but the docs tell customers to `docker run probaline/connector`. | Publish both to a public registry from the deploy workflow, versioned. | ½ day |
| C8 | **"Users included" on a license isn't checked.** | Count active users and keys per company; warn above the limit (don't cut off). | 1 day |
| C9 | **PostgreSQL deployments still need AWS Secrets Manager.** | A secret backend that encrypts into the database with a key from the environment. | 1–2 days |

### D. Running it

| # | Problem | Fix | Size |
|---|---|---|---|
| D1 | **The end-to-end suite isn't in CI.** | Run it in CI with LocalStack and PostgreSQL service containers, on both backends. | 1 day |
| D2 | **Only the gateway autoscales, and only in prod**; the other services run one task outside prod. | Autoscaling for all four; at least two tasks in prod. | ½ day |
| D3 | **No restore runbook or backup test.** Point-in-time recovery is on; nobody has restored from it. | A runbook and a quarterly restore test. | 1 day |
| D4 | **No load test or performance baseline.** | A load test of the request path and MCP calls; record latency added by the checks. | 2 days |
| D5 | **Local development noise**: LocalStack has no KMS, so archiving audit records to S3 fails locally. | Enable KMS in LocalStack or skip the key locally. | ½ hour |

## Order

1. **Make it deployable** (A1–A6, B1): **built** (2026-11-06); not yet run against a real AWS account. Ends
   with a real environment where a platform admin creates a company, its admin is invited, signs in, and the
   company's AI traffic flows.
2. **Close the security settings** (B2–B5, C1, C3): **built** (2026-11-06); not yet run against a real AWS account.
3. **Finish what looks built** (C2, C4–C8): about 2 weeks.
4. **Run it with confidence** (D1–D5, B6, C9): about 1 week, partly in parallel.

Already fixed during this review: the policy engine's AWS permissions (turning a framework on would have
failed), compliance actions through the gateway (Check again never worked), and a HIPAA control that claimed
model access limits that aren't enforced.

## Step 1: what was done

| # | Done | Still to check |
|---|---|---|
| A1 | `FrontendStack`: website, dashboard and docs, each a private S3 bucket behind CloudFront with security headers; `/api/*` on the dashboard and website goes to the gateway. The Deploy workflow builds and uploads all three. | A first deploy to a real account. |
| A2 | The workflow builds each site with the addresses and Cognito IDs the stacks report; `scripts/check-build-env.mjs` refuses a build with missing settings, localhost addresses, or demo sign-in. | Same. |
| A3 | Users API on the gateway (invite, list, change role, turn off, remove, resend) backed by Cognito, with guards (nobody changes themselves; a company always keeps an active admin). Creating a company invites its first admin. The Users page manages people. `scripts/create-platform-admin.mjs` makes the platform's first admin. | Cognito's invitation email in a real pool. |
| A4 | `RegistryStack` creates the image repositories first; images are tagged with the commit and the services roll to that tag. | Same. |
| A5 | The agent reads a 24-hour summary from its own analytics with a signed internal token that can read only that summary, and framework status from its policy engine. If a part can't be read it sends nothing instead of zeros. Audit records are never sent. The platform stores reports (13 months), keeps only what the company allows, and shows the last one. The agent's own API now needs an admin's signed token. | An on-prem install end to end. |
| A6 | The API stack is removed. | — |
| B1 | Browsers reach the gateway on the sites' own address, so an empty `ALLOWED_ORIGINS` now means no other website (instead of any). The browser extension and requests without an origin still work. | — |

Tests: gateway 247, analytics 37, reporting agent 12, policy engine 44, infra 27, dashboard 76, storage 14,
utils 26; end-to-end 36 of 36 on DynamoDB (twice in a row) and on PostgreSQL. The stand-in identity provider
used by the end-to-end suite now keeps its signing key across restarts, so back-to-back runs pass.

## Step 2: what was done

| # | Done | Still to check |
|---|---|---|
| B2 | AWS WAF on the public load balancer: per-address rate limit (default 3000 per 5 minutes), AWS reputation list, AWS common and known-bad-input rules. Rules that inspect bodies only count, because prompts are large and full of code. | Watch the counted rules' hits in a real environment before deciding whether any should block. |
| B3 | Policy engine and data protection answer only requests the gateway signs for them, and refuse a request naming a different company than the token; they refuse to start without the key. The reporting agent may read framework status only. The seed script now goes through the gateway. | — |
| B4 | Per-key and per-MCP-caller limits counted in the shared database, so they hold across gateway instances; `429` with `Retry-After` and `X-RateLimit-*` headers. | One database write per call: measure under load (D4). |
| B5 | The gateway's provider keys and API credentials are encrypted with the platform's KMS key. | Secrets saved earlier keep the default key until saved again. |
| C1 | Records expire per the company's retention period; a daily sweep deletes archive days past it; changing the period re-dates existing records; a legal hold (Settings page, company admins, with a reason) stops all deletion and shows on each case file. | The sweep on a real S3 bucket. |
| C3 | The gateway publishes policy violations, latency and circuit breakers to CloudWatch; the 5xx alarm now watches the gateway's load balancer; every alarm goes to an SNS topic emailed to `alarmEmail`. | Confirm an alarm email arrives. |

Tests: gateway 254, policy engine 46, data protection 7, analytics 37, reporting agent 12, infra 31, dashboard
76, storage 14, utils 26; end-to-end 38 of 38 on DynamoDB and on PostgreSQL.

