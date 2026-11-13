# Customer-run Probaline (hybrid / on-premises)

Status: step 1 built (one image), the rest planned. Rewritten 2026-11-12; replaces the 2026-10-29 and earlier
2026-11-11 versions. Required before the first customer.

## The decision

Two ways to run Probaline:

- **Cloud:** we host it.
- **Customer-run:** the customer runs the Probaline image on their own infrastructure (on-premises, any cloud,
  Kubernetes).
  - It's the whole product: the gateway, every check, the dashboard and reports.
  - It's one lightweight image: the customer installs it, and when a security fix is needed they pull the new
    version we ship.

What some vendors call "hybrid" is, here, simply a customer-run install. **Nothing about a customer's install
reaches us:** no traffic, no counts, no heartbeat. Our platform keeps only our own records of customers and
licenses.

## Who sees what

- **The customer's admins** use the dashboard on their own install: rules, evidence, API keys, models and
  provider keys, MCP servers, approvals, alerts, log export.
- **Probaline's platform admin** sees our own records: customers, plans and the licenses we issued, with their
  end dates. Nothing from the customer's install, so prompts, case files, keys and usage never reach us.
- **Later:** with those records, the platform can email customers before a license ends. It needs nothing from
  their install, because we issued the license and know its end date.

## One license, one gateway

- **A gateway** is one address (for example `ai-gateway.customer.com`), one dashboard and one database.
- **It scales horizontally.** Run as many copies of the image as needed behind the customer's load balancer, all
  using the same database.
- **One license covers one gateway.** A second gateway, for example `ai-gateway.eu.customer.com` with its own
  database, needs its own license. Multiple dashboards per license aren't supported.
- **How it's enforced, without reaching us:** the license names the gateway's address. The gateway serves only
  requests made to that address, so a second deployment at another address needs a second license. The license
  is signed, so its address and end date can't be edited.

## License expiry

The license is a file we sign, carrying the customer, plan, gateway address and end date. The gateway checks the
signature and the date itself; it never contacts us. This is the same timeline Cloud uses today
(`license-state.ts`: active → expiring → grace → lapsed).

| When | What happens |
|---|---|
| 30 days before the end | Notices: a banner on every dashboard page, and email to the company's admins at 30, 14, 7 and 1 days, through their own mail server (SMTP; see INSTALL.md) |
| End date | A 30-day grace period starts. Everything keeps working; the countdown is shown everywhere. |
| After the grace period | **AI requests are refused** with a clear "license expired" error, never passed through unchecked. Admins can still sign in, enter a renewal and read evidence. |
| Renewal | The customer enters the new signed license on the License page. Traffic resumes at once, with no restart. |

- **No early revocation.** Since the install never contacts us, a license can't be revoked before its end date;
  the end date is the control. Keep license terms at a year or less.
- **No remote off switch.** Nothing on our side can stop a gateway. The only stop is the end date the customer
  agreed to, with about 60 days of notice and grace. State this in the license terms.

## Security and compliance commitments

These are the answers to a CISO's review, and the constraints every customer-run feature must keep.

- **The customer's install is the authority.** Rules, settings, keys, case files and the dashboard live with the
  customer. Nothing on our side can read their prompts or change their enforcement, so a breach of Probaline
  can't weaken a customer's protection.
- **Nothing is sent to us.** No traffic, counts, user IDs or heartbeats. We aren't a processor of their data.
- **Their sign-in.** The dashboard uses the customer's SSO (OIDC: Okta, Entra), with local accounts for small
  installs. We have no access; support works from diagnostics the customer chooses to share.
- **One optional download from us, nothing sent.** Once an hour the gateway downloads the public, signed AI
  service catalog (`CATALOG_URL`, by default `https://probaline.com/api/public/catalog/v1/latest.json`), the way antivirus
  definitions are fetched. The request carries no license key, install or company name, counts or user data, only
  a plain user agent and the last ETag. The customer can point it at their own mirror, upload the file by hand
  instead (air-gapped sites), or switch it off (`CATALOG_UPDATES=off`). Nothing else connects to us, inbound or
  outbound: other outbound traffic goes only to the AI providers and the destinations the customer sets up (their
  SIEM, their email, their MCP APIs).
- **Signed releases.**
  - Images are signed with cosign and published with an SBOM (`.github/workflows/deploy.yml` already does both)
    and with the vulnerability policy (SECURITY.md).
  - We support the last three versions.
  - The gateway never updates itself; the customer chooses when.
- **Lightweight.** Copies of one image plus the customer's PostgreSQL (DynamoDB when they run in AWS). Rate-limit
  and other counters live in the database, so Redis isn't needed.

## The image (step 1, built)

One image, `services/Dockerfile`, started by `PROBALINE_ROLE`:

| Role | Runs | Used by |
|---|---|---|
| `all` (default) | The gateway (rules and compliance, secrets, personal data, prompt attacks, all in its process) and reports, which listen only on 127.0.0.1 | Customer installs: one kind of container |
| `gateway` | The gateway alone | Our Cloud, on the prompt path |
| `reports` | Reports alone | Our Cloud, apart from prompts |

- The separate policy-engine and data-protection services are gone; their code runs inside the gateway.
- In the `all` role, the gateway's key for signing calls to reports is made at start-up if the install doesn't set
  one, so a customer configures nothing for it.
- **AWS-only features fall back when off AWS:**
  - Comprehend is optional.
  - Prompt attacks use the phrase list only, unless the customer gives it a Bedrock guardrail.

## Build steps

| Step | What | Size | Status |
|---|---|---|---|
| 1 | One image, run by role; Cloud runs two roles of it | about 1 week | Built 2026-11-12 |
| 2 | Signed license file: local checks of signature, end date and gateway address, with notices and grace; the platform issues licenses as files and tracks customers; remove the reporting agent | about 1 week | Built 2026-11-12 |
| 3 | The image serves the dashboard; the customer's SSO (OIDC) and local accounts | about 1 week | Built 2026-11-12 |
| 4 | Packaging: Helm chart, docker-compose, AWS template, install guide (docs/INSTALL.md), test in a clean environment | about 1 week | Built and tested 2026-11-12 (compose, Helm on kind, AWS in the dev account) |

## How the license works (step 2, built)

- **Issuing (our Cloud):** Licenses page → Issue a license → Runs: On their own infrastructure, with the gateway
  address. The gateway signs the file with a KMS key (`LicenseSigningKey` in the services stack); we keep a copy
  for our records and re-download. A license file can't be revoked.
- **Checking (the customer's install, `LICENSING=offline`):**
  - The gateway trusts only the public keys compiled into the image (`services/gateway/src/licensing/trusted-keys.ts`).
  - The license is entered on the License page, or set in `PROBALINE_LICENSE` when installing, and stored in the
    install's database so every copy agrees.
  - Before any license is entered, the install has 30 days from its first start.
- **One gateway:** requests to an address the license doesn't name are refused with 421 ("This Probaline license is
  for …"). Health checks and the License page answer on any address.
- **Limits, stated plainly:** offline licensing is a commercial control. Someone who alters the image can bypass it,
  as with any offline license; the signed file stops casual copying and editing, and the terms cover the rest.

## Sign-in and the dashboard (step 3, built)

- **The image serves the dashboard,** built for install sign-in (`VITE_AUTH_MODE=install`). It's at the gateway's own
  address, with the API under `/api` as in Cloud. Its pages and files are public; everything they show comes from
  the API, which needs a sign-in.
- **People sign in at the gateway; nothing goes to us.** The gateway issues its own session tokens (ES256, its
  rotating keys, 12 hours) with the same claims a Cloud sign-in carries, so every permission check is unchanged.
  - **Company sign-in (OIDC):** `PROBALINE_SSO_*` settings, using the same OIDC client as MCP sign-in, with PKCE and a
    nonce. Only people already on the Users page get in, matched by email; their role comes from the Users page.
  - **Local accounts:**
    - Adding someone shows the admin a temporary password, once; it's replaced at first sign-in.
    - Passwords need 12 characters with mixed case, a number and a symbol, and are stored as scrypt hashes, apart
      from the user records.
    - Five wrong passwords lock the account for 15 minutes; sign-in attempts are also limited per address.
    - "New temporary password" resets a forgotten one.
  - **Turning someone off or removing them** ends their sessions: at once on that copy of the gateway, within a minute
    on the others.
- **First start:** `PROBALINE_COMPANY_NAME` and `PROBALINE_ADMIN_EMAIL` (plus an optional temporary
  `PROBALINE_ADMIN_PASSWORD`) create the company and its first admin.

## Open questions

- **Moving a license** to a new gateway address: we issue a replacement file. Decide how often that's allowed.
- **Renewal reminders** from our platform: email before the end date, using our own license records.
