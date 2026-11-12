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
| B7 | **The gateway trusts the left-most `X-Forwarded-For` address**, which a caller can set, so its own per-address limits (and the contact form's) can be dodged. Found 2026-11-07. The web firewall's limit isn't affected. | Trust only the hops CloudFront and the load balancer add (`trustProxy` with a hop count per route), or read CloudFront's viewer-address header. | ½ day |

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

### E. Trust between services, and protecting the product on customers' hardware

| # | Problem | Fix | Size |
|---|---|---|---|
| E1 | **One shared secret signs every internal call.** All services (and the reporting agent) hold it, so any one compromised service can create tokens to call any other as the gateway, for any company. It's never rotated. | Only the gateway (and an install's reporting agent, with its own key) holds a private signing key (ES256); internal services hold only public keys, each tied to who may use it. Keys carry an ID; a script rotates them with an overlap. | 2 days |
| E2 | **Prompts travel unencrypted inside the network**, gateway to policy engine, data protection and analytics, through an internal load balancer that can't carry a caller's certificate. | Mutual TLS in the services themselves, so it works the same on AWS, on-premises and Kubernetes: each service has its own certificate from a private CA made per install, encrypts every connection and refuses callers without a valid certificate. On AWS the gateway reaches services directly through private DNS (Cloud Map) instead of the internal load balancer. | 3 days |
| E3 | **Internal services accept connections from the whole network.** | Each accepts only from the gateway's security group. | ½ day |
| E4 | **Containers ship readable code** (and npm, a shell, curl). | Each service bundled to one file and compiled to V8 bytecode; minimal (distroless) images with no shell or source; images signed, with a software bill of materials. | 2 days |
| E5 | **Everything runs on the customer's hardware in a self-hosted install**, including rule authoring, compliance mappings and the AI service catalog. | The hybrid model ([HYBRID.md](HYBRID.md)): the control plane stays with us; the customer runs the data plane, which receives rules and detectors as signed data. Fully air-gapped installs get E4 plus contract terms. | 3–4 weeks |
| E6 | **The detection engine is plain TypeScript**, the part most worth copying and the hottest code on large prompts. | Rewrite the personal-data and secret detectors and rule evaluation in Rust, called from Node, one detector at a time behind the same tests. | 4–6 weeks, gradual |

No packaging stops a determined reverse engineer on hardware they control; E4–E6 make it slow and expensive,
and keep what isn't shipped out of reach. Contract terms (no reverse engineering, a key per customer, a
per-customer build watermark) apply from the first install. Buyers who need to inspect what runs in their
network get a third-party audit, the bill of materials, and source escrow.

## Order

1. **Make it deployable** (A1–A6, B1): **built** (2026-11-06); not yet run against a real AWS account. Ends
   with a real environment where a platform admin creates a company, its admin is invited, signs in, and the
   company's AI traffic flows.
2. **Close the security settings** (B2–B5, C1, C3): **built** (2026-11-06); not yet run against a real AWS account.
3. **Finish what looks built** (C2, C4–C8): **done** (2026-11-07); email and webhooks not yet tried against real SES and chat tools.
4. **Run it with confidence** (D1–D5, B6, C9): **done** (2026-11-07); the CI end-to-end job and the restore test haven't run on GitHub or AWS yet. B7 **done** (2026-11-07). Next: the first real AWS deploy.
5. **Trust between services and protected packages** (E1–E4): **done** (2026-11-07); a first AWS deploy still to run.
6. **Hybrid control plane and a Rust detection core** (E5, E6): later, after the first customers.

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

## Step 5: what was done

| # | Done | Still to check |
|---|---|---|
| E1 | Internal tokens are ES256: only the gateway holds the private key; services hold public keys tied to their owner, so a reporting agent's key can only make reporting-agent tokens. Keys carry IDs, so two can be trusted during a rotation. CDK makes the gateway's key pair on first deploy; `scripts/internal-keys.mjs` makes pairs for rotation and local use. Also fixed: the reporting agent read the policy engine without a token, which step 2 had made it refuse. | — |
| E2 | Mutual TLS in the services themselves: each install's own CA (`scripts/internal-pki.mjs`, run by the Deploy workflow and the local start script), a certificate per service, HTTPS only, callers refused without the right service certificate; the gateway checks it reached the right service. Required in production. On AWS, services connect directly by private DNS name (Cloud Map); the internal load balancer is gone. | A first AWS deploy. |
| E3 | Each internal service's security group admits only the gateway's. | — |
| E4 | One image recipe (`services/Dockerfile`): each service bundled and compiled to V8 bytecode inside a distroless Node image; only the bytecode and a loader ship, as a non-root user. CI checks nothing readable is in the image; the Deploy workflow signs each image and attaches its bill of materials. All five services compile, and the compiled policy engine and gateway were run and called. | — (the policy engine image was built and run: only `app.jsc` and `loader.js` inside, user 65532, 138 MB; it answered over mutual TLS and refused a caller without a certificate). |

Tests: gateway 254, policy engine 50 (including real mutual TLS with certificates from the script), data
protection 7, analytics 37, reporting agent 12, utils 28, infra 32; CDK synth passes; end-to-end 39 of 39 on
DynamoDB and on PostgreSQL, with every internal call over mutual TLS and signed tokens.

## Step 3: what was done

| # | Done | Still to check |
|---|---|---|
| C2 | Alerts that fire: many requests stopped, personal data removed from AI answers or tool results, unapproved AI tools, spend past a share of a monthly budget. Checked after every case file and every batch of extension sightings, off the request path; counted in the shared database so each fires once per window across instances. Email (SES) and webhooks (Slack, Teams, Google Chat or a signed endpoint, with the same address checks as log export: before, any address was accepted, including internal ones). An Alerts page with tests and 90 days of what was sent. | Email through real SES; webhooks into real Slack and Teams. |
| C4 | Applied: each model's longest answer (larger requests capped, recorded) and which API keys may use it (others get `403 MODEL_NOT_ALLOWED`, recorded), both on the Models page. Removed: per-model roles and approval, context size, and five company-level settings nothing read. Data protection can now change only a request's messages, not its model or limits. | — |
| C5 | The contact form emails the team with the visitor as reply-to, keeps the copy, ignores bots (a hidden field) and limits each address to 5 an hour. | A real SES send. |
| C6 | The activity trail and log export are merged; their AWS tables and grants added. | — |
| C7 | Connector and collector images built like the services (bytecode, distroless, non-root, no shell) and published by a release workflow on a version tag: checked, signed, with a bill of materials, to GitHub's registry and Docker Hub. The collector image has a `serve` command; its Azure and Google Cloud jobs updated. | The first release run; the Docker Hub `probaline` namespace must be created and its token added. |
| C8 | The License page counts users (dashboard accounts plus people who used AI in 30 days, each once) against the license and warns above it; nothing is cut off. | — |

## Step 4: what was done

| # | Done | Still to check |
|---|---|---|
| D1 | CI runs the end-to-end suite on DynamoDB and on PostgreSQL (`SITES=off` starts the services only), keeping service logs when it fails. | Its first run on GitHub. |
| D2 | All four services scale on CPU and memory (production: at least two of each); deploys start new copies before stopping old ones; ECS Exec is off (the images have no shell). | — |
| D3 | Point-in-time recovery on every table except the short-lived counters. A restore runbook (`docs/RESTORE-RUNBOOK.md`) for records, whole tables, archives, secrets and the KMS key, and `scripts/restore-test.mjs` for the quarterly test. | The first restore test against AWS. |
| D4 | `scripts/load-test.mjs` and a first baseline (`docs/PERFORMANCE.md`): Probaline adds about 9 ms at p50 and 14 ms at p95 to a request; one gateway process handled about 280 prompts a second on a laptop, running uncompiled. | The same on a deployed stage with the compiled images. |
| D5 | Local archive copies work: the start script warns when the LocalStack container predates KMS. | — |
| B6 | The MCP signing key rotates every 90 days with 7 days of overlap either side, one instance a day under a lock; every instance re-reads keys every 10 minutes. | — |
| C9 | `SECRET_STORE=database`: secrets encrypted in the database (AES-256-GCM, the name as associated data) under a key from the environment, with a key change path. Local PostgreSQL runs and the CI PostgreSQL job use it, so they need no AWS for secrets. | — |

Tests: gateway 299, policy engine 50, data protection 7, analytics 38, reporting agent 12, utils 28, storage 14,
infra 37, collector 98, connector 3, dashboard 86, website 10, docs 3; CDK synth passes for dev and prod;
end-to-end 46 of 46 on DynamoDB and on PostgreSQL (secrets in the database). The connector and collector images
were built and run locally.

## B7: what was done (2026-11-07)

The gateway no longer believes the left-most `X-Forwarded-For` entry. It counts only the entries its own
proxies add, from the right: `TRUSTED_PROXY_HOPS` (0 by default, so local and self-hosted installs use the
connection's address; 1 on AWS for the load balancer). CloudFront sends a generated secret
(`ai-gov/<stage>/edge-secret`) in `x-probaline-edge`; when it matches, CloudFront's entry is believed too, so
dashboard and website users are limited and recorded by their own address rather than by CloudFront location.
The web firewall leaves requests carrying that secret out of its per-address rule for the same reason.

Tests: gateway 307 (including a check that changing `X-Forwarded-For` on each request doesn't get round the
limit), infra 39; CDK synth passes for dev and prod. Still to check on the first deploy: that CloudFormation
fills the secret into CloudFront's header and the firewall rule (both use a Secrets Manager reference), and
that a dashboard user's address in the activity trail is their own.

## Security process: what was done (2026-11-10)

A vulnerability policy and checks on every push, so a known flaw can't ship unnoticed.

| Done | Still to check |
|---|---|
| `SECURITY.md`: private reporting through GitHub, acknowledgement in 2 business days, fix times by severity (critical: hosted 72 hours, release 7 days; high: 7 / 14 days), how customers are told, supported versions. | A security email address once the domain is set; turning on private vulnerability reporting and Dependabot security updates in the repository settings. |
| Dependency audit in CI (`scripts/audit-check.mjs`): high or critical in shipped packages fails the build unless accepted in `security/accepted-risks.json` with a reason and a review date. | First run on GitHub. |
| Image scan in CI (Grype) for every image: high or critical with a fix fails the build. | First run on GitHub. |
| CodeQL (security-extended) on pushes, pull requests and weekly. Dependabot for npm, base images and Actions. Every Action pinned to a commit. | First CodeQL results. |
| **Fixed what the first scans found:** 1 critical and 8 high in shipped packages (fast-jwt, fastify, axios, form-data, fast-uri, find-my-way, js-yaml, brace-expansion) by updating within their versions. Node 20 reached end of life in April 2026 and its images had stopped getting fixes (OpenSSL critical, Node highs): images, CI, deploy and the two Lambda functions move to Node 24 on Debian 13. All seven images now scan clean. | Node 24 on a deployed stage. |
| One high accepted until 2026-12-15: zod 3 can exhaust memory on a huge list with no length limit. Every list callers can send now has a maximum (chat messages 1,000; model tags 50). | Upgrade to zod 4 (breaking, all services). |

Moderate findings left for Dependabot: the dashboard's router (React Router 6 → 7), the collector's Google Cloud
Storage client (major update), and a part bundled inside the AWS CDK (deploy-time only).

## Lock and verify merged (2026-11-10)

The logging branch's weeks 1–4 (shared AI catalog, Enforcement page, AI-domain feeds, the API lock kit, laptop MCP
scan; beta) are merged. Fixed on the way in: the browser tools list now lives once in `@ai-governance/types`, built
from `@ai-governance/catalog`, for the gateway and analytics; the service, connector and collector images build
the catalog; the feeds route records the caller's real address (B7); API key scopes are capped. The Enforcement
page's AWS pieces were missing from the stacks and are added: the `enforcement` table (with point-in-time
recovery), and the gateway's `ENFORCEMENT_TABLE`, `GATEWAY_EGRESS_IPS` (the NAT gateways' addresses, filled in
automatically) and `GATEWAY_ROLE_ARN`. Still to check on the first deploy.

## First AWS deploy: dev stage (2026-11-10)

All seven stacks deployed to a `dev` stage (us-east-1) from images built on a laptop, reached over the load
balancer's AWS address (HTTP) and CloudFront's addresses for the sites. Verified: the gateway answers through
the load balancer and through each site's `/api`; it reaches DynamoDB and the three internal services over mutual
TLS (`/health/deep` all healthy); unknown or missing keys are refused; the sites serve with HSTS, frame and
referrer headers; and the gateway logs the caller's real address whether the request comes straight to the load
balancer or through CloudFront (B7), ignoring a faked `X-Forwarded-For` either way.

Bugs only a real deploy could find, fixed:

| What failed | Why | Fix |
|---|---|---|
| Sign-in stack | Cognito requires the app client to be allowed to write every required attribute (email) | Email added to the client's write attributes; company and role stay read-only. Test added. |
| Policy engine never started | Its TLS secret `…/internal-tls/policy-engine` ends in a hyphen and six letters, which Secrets Manager reads as the random suffix of a secret named `…/policy`, so ECS's fetch was refused | Service certificates are kept as `…/internal-tls/<service>/tls` (`scripts/internal-pki.mjs`). Test guards the naming. |
| Monitoring stack | The Glue table named its database by string, so CloudFormation created it first | Explicit dependency. Test added. |
| Health checks reported the database down | `ListTables` needs access to every table in the account | The check describes one table the service already reads. |
| Deploy workflow would fail | `shared/types` now needs `shared/catalog` built first | Workflows build the catalog first. |

### Live test on the dev stage (2026-11-11)

Signed in as the platform admin, created a company (its admin invited by Cognito email), added a rule, a model
and an API key, then sent prompts and MCP calls through CloudFront and the load balancer.

Worked: dashboard sign-in; company creation and the admin invite; a rule stops a prompt (`403`) with a full
case file and highlighted excerpt; personal data masked before the prompt left (Comprehend in AWS); the activity
trail records each admin change with the person's real address; MCP tools list, a tool call reaches a public
API with a signed identity token, the result comes back filtered (email, URL, IP masked), and bad arguments are
refused before the API is called; MCP refuses calls from browser pages.

Bugs found and fixed:

| What failed | Why | Fix |
|---|---|---|
| Per-key and MCP rate limits, alert counters and the key-rotation lock silently off | The gateway's role had no access to the `metrics` table (LocalStack doesn't check permissions) | Read/write granted; test checks it, including CDK's overflow managed policies |
| No case file when the AI provider refused or failed | The audit record was written only after an answer | A case file marked "not answered" with the provider's reason; the prompt did leave, after the checks |
| Identity tokens on dev named `http://localhost:3000` as issuer | No public address set without `-c gatewayUrl` | Defaults to the load balancer's address |

Answered prompts: the Bedrock connector spoke only Claude's format, so Amazon Nova, Llama and Mistral couldn't
be used (and this account can't call Claude yet: Claude 3 Haiku is retired, current Claude models need AWS to
enable them). It now uses Bedrock's Converse API, so any Bedrock model works, with system instructions,
streaming and token counts; Bedrock's stop reasons are reported as OpenAI's (`stop`, `length`,
`content_filter`). Tested live with Amazon Nova Micro: a clean prompt, a prompt with personal data (masked
before it left; the answer never saw the email or phone number) and a streamed answer, each with a full case file
(model, time, tokens). The dashboard suggests current Bedrock model IDs instead of retired ones.

Found, not fixed yet: the web firewall has no SQL-injection rule set (`AWSManagedRulesSQLiRuleSet`); no
data store is SQL, but buyers will look for it. Not yet tried on the deployed stage: dashboard sign-in (needs the
first platform admin), an AI request with a real key, MCP, alerts by email (no SES sender yet), the restore test
and the load test.

## UI click-through on the dev stage (2026-11-11)

Every page clicked through as a company admin on the deployed dev stage: rules (add, edit, invalid pattern,
on/off, delete, secrets modes, fail mode), API keys (create with expiry and limited permission, replace, revoke,
and that the limits hold), models (test, prices, answer limit, remove), users (invite, role change, turn off/on),
alerts (create, test, a real alert to a webhook with a valid signature), compliance (SOC 2 on, controls, an
unlisted model stopped), shadow AI (allow, block, block-page links), MCP (create a server, add an OpenAPI API,
try a tool, publish, an agent's write call waiting for approval, approve and refuse), evidence (filters, search,
export without the secret), log export (destination, test, real records), enforcement (feed served to a firewall,
AWS policies), legal hold (records keep no expiry) and license (invalid key); phone width and an expired session.

Fixed: one-click delete of a rule and revoke/replace of a key, and switching to "let it through" or turning the
secrets check off without asking (now an in-page confirmation); developer-speak for an invalid pattern; prices
couldn't hold real Bedrock prices (now per million tokens, any precision); Bedrock's raw refusal on Test (now
says to enable the model in the Bedrock console); no warning that alert email isn't set up; SOC 2 CC7.2 said
alerts didn't exist; Evidence lines said "personal data" when secrets were removed; "aws access key" wording; no
feedback after a role change; setup tabs cut off on phones; a dark-mode switch on sign-in that the dashboard
never honoured (removed).

Open, for a decision: the AWS lock policy allows only Probaline's own gateway role, which fits a gateway in the
customer's account but not a hosted customer (their policy should block direct Bedrock use entirely); MCP result
filtering also masks links and user-agent text, beyond the email/phone/SSN/card it advertises. Minor: alert
emails have no dashboard link on dev; the Alerts page doesn't refresh itself after a send; an evidence export
names the exporter by ID, not email; no "your session ended" message.

Platform admin: overview, company details, Usage and Health (every service working, with timings) match the
company's own numbers. Suspend asks first and refuses the company's API key at once ("This tenant is suspended");
Reactivate asks first and the key works again at once. Issuing a license shows the key once; it is refused for
prompts (it only carries the usage-reporting permission). Fixed: "1 tenants", "about under $0.01", Cancel wrapping
under Reactivate. Entered as the company admin, the license took effect at once (Active, 3 of 50 users, the
"no active license" banner gone). Fixed: its Remove used the browser's pop-up (now asks in the page, like other
risky actions); "enterprise plan" in lower case. Other pages still use the browser's pop-up for deletes (alerts,
MCP servers, connectors, revoking a license); they do ask, but should move to the in-page question.

Auditor (signed in as a real `tenant_auditor`): sees Gateway, Stopped, Evidence (case files download), Approvals
(queue only; decides only where a server names them) and Activity; typing an admin page's address goes back to
Gateway. Direct API writes as the auditor (add a rule, create a key, invite a person) were refused with 403 and
nothing changed; every write route that admits an auditor was reviewed (compliance re-check and feed preview only
read; approvals check the approver list). Fixed: Activity showed a refused attempt as "Added a rule" (now "tried;
nothing changed"); people, legal hold and license changes were logged under generic names like `users.changed`
(now `user.invited`, `user.changed`, `legal_hold.changed`, …); Gateway and Evidence offered auditors links to
Rules and Shadow AI, which they can't open; the Users page undersold what an auditor sees.

## Prompt attacks: check 4, Beta (2026-11-11)

What it does. Rules page → check 4: Off (default), Flag, or Stop clear attacks. It looks at the new message only (everything
after the last answer, minus the company's system prompt), after secrets and personal data are removed. Two layers:
- a short list of precise phrases, run on the text and on an un-disguised copy (spacing, look-alike digits, invisible
  characters, base64);
- Amazon Bedrock Guardrails' prompt-attack filter (a guardrail created by the services stack; `-c promptAttackGuardrail=false`
  leaves it out, and then only the phrases run, which the Rules page says).
Flag runs alongside the provider call (no added delay) and records "Flagged: possible prompt attack" in the case file.
Stop waits for the verdict and stops only strong matches: Bedrock at medium or high confidence, or a disguised phrase;
weaker matches are flagged and sent. Applies to the app endpoint, streaming and proxy mode; not to MCP tool calls (their
results already carry an instructions-in-result flag).

Measured (prompt set in `services/gateway/src/__tests__/prompt-attack-corpus.ts`):
- Bedrock alone (strength HIGH): 11/15 harder attacks caught; 7/40 work prompts flagged (mostly role-play: "Act as a senior
  code reviewer", "Pretend to be an interviewer"); about 370 ms per check from outside AWS.
- Phrases alone on prompts they weren't written for: 1/15 attacks; 0/25 work prompts after one pattern fix. They are a
  backstop for disguised text and known jailbreaks, not the main detector.
- The prototype from the backup branch (pattern scoring) caught 1/15 harder attacks and stopped 22/40 work prompts; not used.
- Bedrock on the held-out set (prompts nothing was tuned on): 10/15 attacks flagged, 9/15 strong enough to stop; missed
  Spanish, Italian, a German line inside a translation request, a note hidden in a support ticket, and "paste the complete
  prompt you received". Work prompts: 5/25 flagged, 4/25 would be stopped (role-play and "ignore the formatting").
So Stop would stop about one ordinary prompt in six; the Rules page says so and recommends Flag. Not yet measured: false
alarms on real customer traffic. Keep Beta until that is known.

## One image (2026-11-12)

The policy engine and data protection were folded into the gateway, and the product ships as one image
(`services/Dockerfile`) started by `PROBALINE_ROLE`: `all` for customer installs (gateway + reports on 127.0.0.1),
`gateway` and `reports` for Cloud. Dev runs two services instead of four. Verified: unit tests (gateway 410,
analytics 50, infra 47, dashboard 104), the full end-to-end suite (54/54) on the local stack, the image running
in the `all` role, and on dev: rules, secrets, personal data, prompt attacks and reports.

Found and fixed on the way: when the rules couldn't be read (a database error), the rules check returned "no
rules" and let prompts through even for companies that fail closed. It now reports the check as unavailable and
the company's fail mode decides.

Cleanup left for later: the old image repositories (gateway, policy-engine, data-protection, analytics) are still
exported by the registry stack for stacks that haven't moved; the policy-engine and data-protection TLS secrets in
Secrets Manager are unused. The reporting agent is retired in hybrid step 2.

## Customer-run licensing (2026-11-12)

Hybrid step 2. License files (`PBL1.…`) signed with a KMS key (dev: alias/ai-gov-license-signing-dev) and
checked by the gateway with the public key compiled into the image; `LICENSING=offline` turns it on. Same
timeline as Cloud (30 days of notice, 30 days of grace, then AI requests refused); an unlicensed install has 30
days from first start. The gateway serves only the address the license names (421 otherwise). Platform admins
issue files from the Licenses page ("On their own infrastructure" + gateway address), download them again, and
can't revoke them. The reporting agent and its endpoints are removed: customer-run installs send nothing to us.

Verified: unit tests (gateway 416, analytics 50, dashboard 107, infra 48); a license signed through the dev KMS
key, run in the customer image offline: active, licensed address served, other address refused, health open.
Not yet clicked: issuing a file from the Licenses page as a platform admin on dev.

## Customer-run sign-in and dashboard (2026-11-12)

Hybrid step 3. The image serves the dashboard and signs people in itself: company SSO (OIDC) and local accounts,
with the gateway's own session tokens. Verified: gateway tests 425 (including SSO start and return with a stand-in
provider, lockout, turn-off ending sessions, path-traversal checks on served files), dashboard tests 110, the
end-to-end suite 54/54 (Cloud unaffected), and the image itself: first admin created, signed in through the served
dashboard, the temporary password replaced, a person added with a temporary password shown once. Found and fixed:
an inline script in the dashboard's page was blocked by the gateway's security policy (moved to a file).
Not yet tried against a real identity provider (Entra ID, Okta).

## Packaging (2026-11-12)

Hybrid step 4: `deploy/compose` (gateway + PostgreSQL, optional Caddy for HTTPS), `deploy/helm/probaline`
(non-root, read-only, spread across nodes, disruption budget, optional autoscaling, settings from a Secret),
`deploy/aws/probaline.yaml` (ECS Fargate, RDS PostgreSQL with TLS verified against the RDS CAs baked into the
image, internal HTTPS load balancer), and `docs/INSTALL.md`. Also: `OBJECT_STORE=none`, PostgreSQL settings as
PG* variables (for RDS-managed passwords), first start safe when several copies start together.

Verified:
- **compose,** from a clean folder:
  - the first admin was created and could sign in;
  - the install started with 30 days of grace;
  - a restart kept sessions and passwords;
  - the archive volume was writable.
- **Helm,** on kind (Kubernetes 1.37):
  - 2 copies, non-root and read-only, passed their probes;
  - starting together, they made one company and one admin;
  - a sign-in on one copy worked on the other;
  - the license was active, and other addresses were refused (421).
- **AWS template,** deployed in the dev account:
  - RDS PostgreSQL 16, with TLS checked against the RDS certificate authorities;
  - 2 Fargate tasks, with one company and one admin between them;
  - the first admin's temporary password was in CloudWatch, as documented;
  - sign-in worked over HTTPS through the load balancer;
  - the license was active, 10 of 10 requests succeeded across both tasks, and the dashboard loaded;
  - the load balancer's own name was refused (421), and plain HTTP was closed.
  - The test stack, its snapshot, the retained key secret, the test certificate and the test image were deleted
    afterwards.

## Email for customer-run installs (2026-11-12)

SMTP through the customer's own mail server (`SMTP_*`), beside SES in AWS. Always encrypted (STARTTLS on 587 or
TLS on 465) with the server's certificate checked (`SMTP_CA` for a private CA); nodemailer 10.5.0 (earlier versions
have open high advisories). The Alerts page says how email is sent and has "Send me a test email". License notices
now go by email to every admin at 30, 14, 7 and 1 days before the end, the same points through grace, and once if
AI requests stop; each once whatever the number of gateway copies, retried if the mail server refuses.
Verified: unit tests, and a real SMTP server (Mailpit, STARTTLS required): an untrusted certificate was refused,
and with SMTP_CA the message arrived.

## From beta to release, wave 1 (2026-11-12)

| Item | Now | Verified |
|---|---|---|
| IDE (proxy) mode: personal data | Removed from prompt text before it's forwarded (system prompts, messages, text blocks, tool results; OpenAI, Anthropic, Cohere and Mistral formats). Model names, tool definitions, images, IDs and the assistant's own tool calls are left as sent. Fail mode applies if masking fails. Answers still pass straight through. | Unit tests per format; end to end: email and SSN never reach the model, and the case file says "cleaned". |
| MCP with a real client | — | End to end with the official MCP SDK (`@modelcontextprotocol/sdk`, Streamable HTTP, as Claude Code and Cursor use): connects, lists and calls tools. |
| Elastic | OTLP export now sends protobuf by default (every OpenTelemetry receiver must accept it; APM Server takes only protobuf). JSON stays as a per-destination choice (`otlpEncoding`). | Elasticsearch and APM Server 8.15.3: the test record, admin activity and a stopped request landed in `logs-apm.app.probaline-default` with severity and labels. |
| API identity check | — | Already end to end: a direct call is refused; the same call through Probaline passes the package's guard with who asked. |
| End-to-end suite in CI | Already in `ci.yml`, on DynamoDB and PostgreSQL. | Its first run on GitHub. |
| Splunk | — | Splunk Enterprise 9.4 on a temporary EC2 server (x86; deleted afterwards): the test record, admin activity and a stopped request arrived through HEC in index `main` with sourcetypes `probaline:<type>`; `type`, `action`, `outcome` and `requestId` searchable with no setup. |
| Labels | Website: IDE mode and MCP now Available; the Deployment page shows Cloud and Your infrastructure (both Available) in place of the old hybrid and self-hosted cards; the Security page's sign-in and license lines updated. Dashboard: Splunk and Elastic marked Tested; Log export no longer beta (Datadog and Sumo Logic stay marked Beta). Docs: proxy-mode and MCP beta notes removed. | Website, docs and dashboard tests. |

Still open: Datadog and Sumo Logic; the
Deploy workflow's first real run on GitHub (needs the AWS role and secrets); SSO with a real Okta or Entra tenant;
the Go and Java identity snippets.
