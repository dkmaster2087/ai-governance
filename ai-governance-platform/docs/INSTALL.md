# Installing Probaline on your own infrastructure

Probaline runs as **one container image**: the AI gateway, every check (rules, secrets, personal data, prompt
attacks), the dashboard and reports. You run as many copies as you need behind your load balancer, all using one
PostgreSQL database.

Nothing is sent to Probaline: not prompts, answers, usage or a heartbeat. The gateway checks its license by itself.

Three ways to install:

| | Use it for | Files |
|---|---|---|
| docker compose | One server: a trial, or a small company | `deploy/compose/` |
| Helm chart | Kubernetes, any cloud or on-premises | `deploy/helm/probaline/` |
| AWS template | Your AWS account: ECS Fargate, RDS PostgreSQL, an HTTPS load balancer | `deploy/aws/probaline.yaml` |

## Before you start

- **The image.** Probaline gives you an image name and version, such as `registry.example.com/probaline:1.0.0`.
  - Check it's ours with `cosign verify <image>`. Every release is signed and comes with a software bill of
    materials.
  - Copy it into your own registry if your servers can't reach ours.
- **An address for the gateway**, for example `ai-gateway.customer.com`, and a TLS certificate for it. People open
  the dashboard there, and apps send AI requests there. **The license names this address**, and the gateway serves
  only that address. A second gateway, such as one for another region, needs its own license.
- **A license file** from Probaline (`PBL1.…`). The install works for 30 days without one.
- **PostgreSQL 14 or later.** Size: 2 vCPUs and 4 GB of memory serve hundreds of requests a second. Records take
  about 2 KB each, kept for your retention period (365 days unless you change it).
- **Outbound access** from the gateway to the AI providers you use (for example `api.openai.com`, or Bedrock in
  your AWS account), to your SIEM, and to your identity provider. **Nothing goes to Probaline.**

## Settings

| Setting | Needed | What it is |
|---|---|---|
| `PUBLIC_GATEWAY_URL` | Yes | The gateway's address with `https://`, as in the license |
| `DATABASE_URL` | Yes* | `postgres://user:password@host:5432/probaline?sslmode=verify-full`. *Or PostgreSQL's own `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` and `PGSSLMODE` |
| `SECRETS_ENCRYPTION_KEY` | Yes | Encrypts provider keys and other secrets in the database. Make one with `openssl rand -base64 32`, and **keep a copy somewhere safe**: without it, saved provider keys can't be read. To change it, see "Changing the encryption key" |
| `PROBALINE_COMPANY_NAME`, `PROBALINE_ADMIN_EMAIL` | First start | Your company, and the first admin |
| `PROBALINE_ADMIN_PASSWORD` | No | The first admin's temporary password. Without one, one is made and written once to the log (search for "first admin") |
| `PROBALINE_LICENSE` | No | The license file's text. It can be entered on the License page instead |
| `PROBALINE_SSO_ISSUER`, `PROBALINE_SSO_CLIENT_ID`, `PROBALINE_SSO_CLIENT_SECRET`, `PROBALINE_SSO_NAME` | No | Company sign-in. See "Signing in" |
| `OBJECT_STORE` | No | Archive copies of audit records: `none` (the database already has every record), `file` (with `OBJECT_STORE_DIR`; every copy must write to the same volume), or `s3` (with `AUDIT_LOG_BUCKET`, plus `S3_ENDPOINT` for MinIO or another S3-compatible store) |
| `AUDIT_DB_DAYS` | No | Days audit records stay in the database (default 90). Older records, up to each company's retention, are read from the archive, more slowly. Ignored with `OBJECT_STORE=none`: the database then keeps the full retention period |
| `TRUSTED_PROXY_HOPS` | No | How many proxies in front add `X-Forwarded-For`. Usually 1 (your load balancer or ingress) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_TLS`, `SMTP_CA` | No | Email through your own mail server. See "Email" |

The packages set the rest: `LICENSING=offline`, `STORAGE_BACKEND=postgres` and `SECRET_STORE=database`.

## docker compose (one server)

```bash
cd deploy/compose
cp .env.example .env                       # image, database password, port
cp probaline.env.example probaline.env     # Probaline's settings (table above)
docker compose up -d
```

- The gateway listens on port 3000. Put your HTTPS proxy in front of it, and pass the original `Host` header (the
  gateway checks the address).
- With no proxy, `docker compose --profile https up -d` adds Caddy, serving HTTPS with your certificate. Put the
  certificate in `certs/gateway.crt` and `certs/gateway.key`.
- PostgreSQL runs in the same compose project, with its data in a Docker volume. Back that volume up, or point
  `DATABASE_URL` at your own database.

## Kubernetes (Helm)

1. Put the secret settings in a Secret, so they never sit in your values file:

   ```bash
   kubectl create secret generic probaline-settings \
     --from-literal=DATABASE_URL='postgres://probaline:…@db.internal:5432/probaline?sslmode=verify-full' \
     --from-literal=SECRETS_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
     --from-file=PROBALINE_LICENSE=probaline.license
   ```

2. Install the chart:

   ```bash
   helm install probaline deploy/helm/probaline \
     --set image.repository=registry.example.com/probaline --set image.tag=1.0.0 \
     --set publicUrl=https://ai-gateway.customer.com \
     --set existingSecret=probaline-settings \
     --set company.name="Customer Inc" --set company.adminEmail=security@customer.com \
     --set ingress.enabled=true --set ingress.className=nginx --set ingress.tlsSecretName=ai-gateway-tls
   ```

What the chart does:
- **Copies:** it runs 2 by default, spread across nodes, with a disruption budget and optional autoscaling.
- **Lockdown:** containers run as non-root, with a read-only file system, no Linux capabilities and no
  service-account token.
- **Health:** the readiness probe checks the database.
- **Archive copies** are off by default (`objectStore.kind=none`). For `file`, enable `persistence` with a
  ReadWriteMany storage class; for S3, set `objectStore.kind=s3`.
- **Settings:** every other setting is in `values.yaml`, with comments.

## AWS (CloudFormation)

`deploy/aws/probaline.yaml` builds Probaline in an existing VPC:

- **Gateway:** ECS Fargate, 2 tasks by default, in private subnets.
- **Database:** RDS PostgreSQL 16, encrypted, with 14 days of backups and deletion protection. RDS makes the
  password and keeps it in Secrets Manager.
- **Database connection:** TLS, with the database's certificate checked (the image carries the RDS certificate
  authorities).
- **Load balancer:** HTTPS only, TLS 1.2 or later. It's internal by default, so apps and people reach it over
  your network.
- **Encryption key:** generated in Secrets Manager, and kept if the stack is deleted.

Steps:
1. Copy the image into your ECR, and request (or import) an ACM certificate for the gateway's address.
2. Create the stack. You need private subnets with a NAT route, and subnets for the load balancer:

   ```bash
   aws cloudformation deploy --template-file deploy/aws/probaline.yaml --stack-name probaline \
     --capabilities CAPABILITY_IAM \
     --parameter-overrides ImageUri=<ecr>/probaline:1.0.0 GatewayAddress=ai-gateway.customer.com \
       CertificateArn=arn:aws:acm:… VpcId=vpc-… LoadBalancerSubnetIds=subnet-a,subnet-b \
       ServiceSubnetIds=subnet-c,subnet-d AdminEmail=security@customer.com CompanyName="Customer Inc"
   ```

3. Point the gateway's address at the `LoadBalancerDns` output.
4. Find the first admin's temporary password in the CloudWatch log group (search for "first admin").

To use Amazon Bedrock models, allow `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on the
stack's TaskRole.

## First sign-in

1. Open `https://<gateway address>`.
2. Sign in as the first admin with the temporary password, then choose your own.
3. On the **License** page, enter the license file if you didn't set `PROBALINE_LICENSE`.
4. On **Models & keys**, add your AI providers. On **API keys**, make keys for your apps. Apps then send requests to
   `https://<gateway address>/v1/chat/completions`, an OpenAI-compatible endpoint.
5. On **Users**, add people. Each gets a temporary password, shown to you once to pass on.

## Signing in

- **Company sign-in (recommended):** register Probaline as an OIDC web application in Entra ID, Okta, Google or
  any OpenID Connect provider.
  - Redirect URI: `https://<gateway address>/v1/auth/sso/callback`. Scopes: `openid email profile`.
  - Set the `PROBALINE_SSO_*` settings. The sign-in page then shows "Sign in with <PROBALINE_SSO_NAME>".
  - Only people added on the Users page can sign in, matched by email; their role comes from that page.
  - An identity provider on a private address is refused unless you set `MCP_ALLOW_PRIVATE_BACKENDS=true`.
- **Passwords:**
  - At least 12 characters, with upper and lower case, a number and a symbol.
  - Five wrong passwords lock the account for 15 minutes.
  - An admin can make a new temporary password on the Users page.
- **Sessions** last 12 hours (`SESSION_HOURS`). Turning someone off ends their sessions within a minute.

## Email

Alerts and license notices go by email **through your own mail server**: Exchange, a Microsoft 365 or Google
Workspace SMTP relay, Postfix, SendGrid or any SMTP service. Nothing goes through Probaline.

- **Settings:**
  - `SMTP_HOST`, plus `SMTP_FROM`, the address Probaline sends from (for example `Probaline <probaline@customer.com>`).
  - The port is 587 with STARTTLS by default. Use `SMTP_TLS=tls` for port 465.
  - `SMTP_USER` and `SMTP_PASSWORD` if your relay needs a login.
- **Encryption:** the connection is always encrypted, and the server's certificate checked. If your mail server's
  certificate comes from your own certificate authority, put that CA's PEM text in `SMTP_CA`.
- **Microsoft 365:** use `smtp.office365.com` with a licensed mailbox's login (SMTP AUTH enabled for it), or a
  connector-based relay.
- **Google Workspace:** use `smtp-relay.gmail.com`, allowing the gateway's outbound address.
- **Testing it:** on the **Alerts** page, **Send me a test email** sends one to you. If your mail server refuses, its
  answer is shown, for example a wrong login or a relay that won't accept the sender.
- **License notices** go to every admin at 30, 14, 7 and 1 days before the license ends, at the same points through
  the grace period, and once if AI requests stop.
- **In AWS,** Amazon SES works too: set `EMAIL_FROM` to an SES-verified address, and allow `ses:SendEmail` on the
  task role.

## The license

- The gateway checks the license file itself, never contacting Probaline:
  - its signature;
  - its end date;
  - its address: requests to any other address are refused.
- **30 days before the end:** a notice on every dashboard page, and an email to every admin if email is set up.
- **At the end:** 30 days of grace, then AI requests are refused (never passed through unchecked) until a renewal is
  entered on the License page. Admins can still sign in, enter a renewal and read evidence.
- **New install:** the same 30 days apply until the first license is entered.

## Upgrades and security fixes

- Probaline publishes signed versions, and security fixes in new versions (see SECURITY.md). We support the last
  three versions.
- **To upgrade,** change the image tag:
  - docker compose: `docker compose up -d`
  - Helm: `helm upgrade`
  - AWS: update the stack's `ImageUri`
- Copies are replaced one at a time, so traffic keeps flowing. The database is upgraded on start, and nothing
  else is needed.
- Nothing updates itself: you choose when.

## Backups

Back up **the PostgreSQL database** and **`SECRETS_ENCRYPTION_KEY`**. The database holds everything: rules,
settings, users, keys (encrypted), audit records and case files. The key is needed to read the encrypted secrets.
The image holds no state.

## Changing the encryption key

1. Set the new key as `SECRETS_ENCRYPTION_KEY`, and the old one as `SECRETS_ENCRYPTION_KEY_OLD`.
2. Restart. Secrets are re-encrypted with the new key as they're next saved.
3. Remove the old key once every provider key has been saved again.

## Known limits

- **Prompt attacks:** without a Bedrock guardrail (AWS only), the prompt-attack check uses its phrase list alone,
  which catches fewer attacks.
- **Comprehend** (deeper personal-data detection) is AWS only. The built-in detectors run everywhere.
