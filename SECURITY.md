# Security policy

Probaline sits between a company and its AI providers and tools, so a flaw in it is a flaw in our customers'
defences. This page says how to report one, how fast we fix it, and how customers hear about it.

## Reporting a vulnerability

Report privately through GitHub: **Security → Report a vulnerability** on this repository
(private vulnerability reporting). Please don't open a public issue, pull request or discussion.

Include what you can:

- what an attacker could do, and what they need first (an API key, a dashboard role, network access);
- steps or a proof of concept, against your own installation or a test company, never a customer's;
- the version (`--version` for the connector and collector; the dashboard footer for the platform) and whether
  it's our hosted service or a self-hosted install.

We won't take legal action over research that follows this page: test only what you own or are allowed to test,
don't read, keep or change other people's data, don't degrade the service for others, and give us the time
below before publishing.

## What happens next

| Step | When |
|---|---|
| We acknowledge your report | within 2 business days |
| We confirm it, or explain why it isn't a vulnerability, and give it a severity (CVSS 4.0) | within 5 business days |
| Fixed, as below | |
| Advisory published, crediting you if you'd like | when the fix is out, or at 90 days, whichever comes first, unless we agree otherwise |

## How fast we fix

Counted from when we confirm the report.

| Severity | Hosted service fixed, or the risk removed | Release for self-hosted installs |
|---|---|---|
| Critical | 72 hours | 7 days |
| High | 7 days | 14 days |
| Medium | 30 days | next release, within 30 days |
| Low | 90 days | next release |

Where a full fix takes longer, we first remove the risk: turn the feature off, add a firewall rule, or rotate the
affected keys. Customers are told what to do in the meantime.

The same times apply to known vulnerabilities in the packages and base images we ship (below).

## How customers hear about it

- **Hosted service:** we patch it; nothing for you to do. Anything that exposed your data or needs action on your
  side (rotating a key, checking logs) is told to your company's admins by email, with what happened and when.
- **Self-hosted installs, connector and collector:** a GitHub security advisory on this repository, and an email to
  your registered admins with the fixed version and any steps to take. Releases are signed, with a bill of
  materials (see README, "Releases").

## Supported versions

- **Hosted service:** always the current version.
- **Self-hosted platform, connector and collector:** the latest release, and the release before it for 90 days
  after a new one. Older versions don't get fixes; upgrade first.

## How we look for problems ourselves

Every push and pull request runs:

- **Dependency audit:** known vulnerabilities in the packages that ship. A high or critical one fails the build
  unless it's recorded in [`security/accepted-risks.json`](ai-governance-platform/security/accepted-risks.json)
  with why it can't be exploited and a date to look again. A passed date fails the build too.
- **Image scan:** each service, connector and collector image is scanned. A high or critical vulnerability that
  has a fix fails the build.
- **CodeQL:** static analysis of our own code for injection, unsafe redirects, weak crypto and similar flaws,
  also run weekly.
- **What ships:** images hold compiled bytecode only, with no shell, package manager or source, and don't run as
  root.

Dependabot opens updates as soon as an advisory is published, and weekly for routine updates. GitHub Actions are
pinned to exact commits. Release images are signed (cosign) with a bill of materials attached.
