# MCP gateway: governed access from AI agents to company systems

Status: phases 1 and 2 built (beta): servers created on demand, APIs from OpenAPI, people signing in through
the company's identity provider, group access, write tools with approvals, versions, signed identity for
backends, and the connector for APIs inside the company network. Phases 3–4 planned. Written 2026-11-05,
updated 2026-11-06.

## Why

Probaline governs AI traffic **leaving** the company: prompts to model providers. The other direction is growing
faster: AI agents (Claude, ChatGPT, Copilot, Cursor and the company's own agents) reaching **into** company
systems through the Model Context Protocol (MCP). Today each team stands up its own MCP server in front of an
internal API, with its own sign-in, no shared rules and no record of what the agent read or changed.

With Probaline, an admin **creates MCP servers on demand** from the dashboard: as many as they need, each in front
of one or more company APIs ("HR", "Finance, read-only", "Customer support"). Each server gets its own address,
its own tools, its own list of who may connect and its own approval rules. People sign in with the company's
identity provider, and every tool call passes the same checks and leaves the same evidence as a prompt does
today. Nobody writes or hosts MCP server code.

The pitch becomes: **every AI interaction with your data, in either direction, goes through Probaline.** The
market review found no answer to agents and MCP in Probaline so far, and that's where budgets are moving.

## What it is

```
 Agent (Claude, Cursor, Copilot, own agent)
   │  MCP over HTTPS (Streamable HTTP), OAuth token for one person or one workload
   ▼
 Probaline gateway  ── /mcp/{tenant}/{server}      one address per MCP server the admin created
   ├─ 1. Who: verify the token (company identity provider, or a Probaline API key for workloads);
   │        the caller must be allowed on this server
   ├─ 2. Which tools: this server's tools, filtered to what the caller's groups may use
   ├─ 3. Arguments: schema check, policy rules, secrets check
   ├─ 4. Approval: write actions marked "needs approval" wait for a person
   ├─ 5. Call the backend with Probaline's own credential for it; pass who asked, signed
   ├─ 6. Result: personal data masked, prompt-injection screening, size limit
   └─ 7. Case file: who, which tool, arguments (masked), outcome, timing
   ▼
 Company API (cloud, or on-premises through the self-hosted gateway or a connector)
```

Two kinds of tool source:

- **APIs.** An admin registers an API with its OpenAPI description and picks the operations that become tools.
  This is the first version.
- **Existing MCP servers.** An admin registers an MCP server the company already runs, or a vendor's hosted one,
  and Probaline sits in front of it with the same checks. This is phase 3.

## MCP servers on demand

An **MCP server** in Probaline is a named, configured endpoint, not a program to deploy. Creating one takes
seconds and costs nothing to run while idle: the gateway serves every server, and a server is its configuration
(APIs, tools, access, approvals, limits). Pausing or deleting one takes effect at once.

### Creating one (dashboard → **MCP servers** → **Create MCP server**)

1. **Name and purpose.** "HR self-service", with a short description agents and people see.
2. **Who can connect.** Groups from the identity provider (people), and/or Probaline API keys (the company's
   own agents). Nobody else can even list its tools.
3. **Add backend APIs.** One or more: base URL, OpenAPI description (upload, URL, or start from a template), the
   credential Probaline uses for it, and, for an on-premises API, which connector reaches it.
4. **Choose tools.** Probaline lists the operations. Reads are on by default; writes are off until switched on,
   and each write is **allowed** or **needs approval**. Names and descriptions can be edited for agents.
5. **Approvals and limits.** Who approves writes, how long a request waits, calls per minute per person, and the
   largest result returned.
6. **Try it.** A test console in the dashboard calls a tool as a chosen user, through every check, before anyone
   connects.
7. **Publish.** The server gets its address, `https://<gateway>/mcp/<company>/<server>`, plus copy-paste setup
   for Claude, ChatGPT, Cursor, VS Code and other MCP clients.

### Living with it

- **Draft and published.** Edits to a published server (new tools, changed descriptions, wider access) are made
  as a draft and published deliberately, so agents never see half-made changes. Each publish is a version; a
  version can be restored.
- **Pause, expire, delete.** A server can be paused (agents get a clear "paused" answer), given an end date (for
  a project or a contractor), or deleted. Deleting keeps its case files.
- **One page per server:** calls, stops, approvals waiting, top tools and top users, with links to case files.
- **Isolation, later.** Every server runs inside the shared gateway by default. Regulated customers can ask for
  a server to run in its own process (and, self-hosted, its own container), with its own credentials store, so
  one server's problem can't affect another.

## Identity

### Agents to Probaline

MCP's authorization model is OAuth 2.1. The MCP endpoint is a protected resource; clients discover how to sign
in from its metadata (OAuth Protected Resource Metadata) and get a token for that endpoint only.

- **People:** Probaline runs a small authorization server for MCP clients (authorization code with PKCE; client
  registration through Client ID Metadata Documents or dynamic registration, which many MCP clients expect).
  It doesn't keep passwords. The sign-in itself is delegated to the company's identity provider: Entra ID,
  Okta, Google, or any OIDC or SAML provider, federated per tenant. Group claims from the identity provider
  decide which tools a person gets.
- **Workloads** (a company's own agents): a Probaline API key with a new `mcp` scope, or OAuth client
  credentials. Keys are already per tenant, scoped, hashed and revocable.
- Tokens are short-lived, bound to the tenant's MCP endpoint (resource indicator), and checked on every
  request. Revoking a person in the identity provider ends their access at the next refresh.

### Probaline to the backend

The agent's token is **never** passed to the backend (MCP forbids token passthrough: it would let a token meant
for Probaline act directly on the API, around every check). Instead:

- Probaline calls the backend with **its own credential for that API**, stored like provider keys today. It can
  be an API key, an OAuth client-credentials grant, mTLS, or a cloud role.
- It tells the backend **who asked**, in a short-lived token Probaline signs (`X-Probaline-Identity`: user,
  groups, tenant, tool, request ID), verifiable with Probaline's published key. The backend can keep enforcing
  its own per-user rules.
- **Later:** on-behalf-of token exchange (RFC 8693), for backends that must see the person's own identity
  token from the identity provider.

## Tools

Tools come from the backend APIs added to a server (step 4 above). For each tool Probaline keeps:

- the name and description agents see (taken from the API, editable, then frozen: a backend can't change what
  agents are told),
- the argument schema (from OpenAPI),
- read or write, and for writes **allow** or **needs approval**,
- which of the server's groups may use it (all, by default), and its limits.

The same API can sit behind several servers with different tools: "Finance, read-only" for everyone in
finance, and "Finance, payments" with approvals for a few people. The tool list an agent sees is filtered to
what the caller may use. Published changes notify connected agents (`tools/list_changed`).

**Templates** for common systems (ServiceNow, Jira, Confluence, Salesforce, Workday, an internal Postgres
read-replica through a small SQL API) give a sensible starting set of read tools, so a first server takes
minutes.

## Checks on every call

Before any of these, the caller is checked: an API key with the mcp permission or a person's sign-in token for this server, a tenant that isn't suspended, a license that hasn't ended, a published server that isn't paused, and the server's access list. The full order is in [ARCHITECTURE.md](ARCHITECTURE.md#request-path-ai-agents-mcp).

| Step | What happens | Built on |
|---|---|---|
| Arguments | Validated against the schema; unknown fields refused | new |
| Arguments | Company rules (words, patterns, personal-data types, rate limits); a rule set to block stops the call. Model rules don't apply | policy engine, as for prompts |
| Arguments | Secrets check: an agent mustn't send a key or password into an API. Always stops the call (a tenant set to redact for prompts still stops tool calls); only `off` skips it | secrets check |
| Write actions | "Needs approval": the call waits; an approver sees tool, arguments and caller, and approves or refuses in the dashboard; the agent gets the outcome. Timeout refuses | new |
| Result | Personal data masked unless the server is set to return it | data protection service (the gateway's own scanner if it's down) |
| Result | Prompt-injection screening: text that tries to instruct the agent is flagged with a note the agent sees, and recorded | patterns today; a classifier later |
| Result | Size cap, so one call can't empty a database into a chat | new |
| All | Calls a minute per caller per server, and per API key; the tenant's fail mode when the rules can't be checked (closed: no call; open: call made and marked) | shared counters |

Every call gets a **case file**, like prompts today: who (person or workload), agent, tool, arguments (masked),
checks and their outcome, approval if any, backend status, timing. Results aren't stored, only a fingerprint,
as for delivered prompts.

## Reaching the API

| Where the API is | How Probaline reaches it |
|---|---|
| Public or cloud | Directly from the gateway over HTTPS |
| Customer's VPC or data centre, self-hosted Probaline | Directly; the gateway runs inside their network |
| Customer's network, cloud Probaline | **Connector** (phase 2): a small container in their network that opens an outbound TLS connection to Probaline and carries calls for the APIs it's allowed to reach. No inbound firewall change; each connector has its own allowlist of hosts. |

The gateway only calls registered base URLs. Redirects to other hosts, private address ranges not on the list,
and cloud metadata addresses are refused, so a tool can't be turned into a way to probe the network.

## Threats and answers

| Threat | Answer |
|---|---|
| Token passthrough, confused deputy | Agent tokens are only valid at Probaline; backends see Probaline's credential plus a signed statement of who asked |
| Over-broad tools | Reads on by default, writes chosen one by one; per-group grants; approval for risky writes |
| Prompt injection through results | Result screening; results are marked as data; size caps |
| Tool poisoning (a backend changes what agents are told) | Names, descriptions and schemas are copied at registration and only change through an admin |
| Data leaving through arguments | Policy rules and the secrets check on arguments; case file for every call |
| Network probing (SSRF) | Only registered base URLs; private ranges, metadata addresses and cross-host redirects refused |
| A stolen agent token | Short-lived, bound to one tenant's endpoint, revocable through the identity provider; rate limits |
| Runaway agents | Rate limits per person and tool; the tenant can switch a tool or the whole endpoint off at once |

## Data

New collections in the storage layer (DynamoDB or PostgreSQL, like everything else):

| Collection | Holds |
|---|---|
| `mcp_servers` | Each server: name, status (draft, published, paused), who may connect, approvers, limits, end date, published version |
| `mcp_apis` | Registered APIs: base URL, OpenAPI fingerprint, credential reference (the secret itself in the secret store), connector |
| `mcp_tools` | Tools per server: frozen name, description and schema; read or write; allow or needs approval; groups; limits |
| `mcp_approvals` | Pending and decided approvals |
| `mcp_clients` | Registered OAuth clients and consent per tenant |

Tool calls are audit records, with `kind: mcp_tool_call`, so the Evidence and Stopped pages show them with no
second system.

## Dashboard

- **MCP servers** in the main menu: the list of servers with status and calls this week, and **Create MCP
  server** (the steps above). Each server has its own page: tools, access, approvals, versions, test console,
  activity. Tools read like the Rules page: sentences, not forms.
- **Approvals**: a queue for approvers, with a notification (email or webhook) when something waits.
- The **Gateway** picture gains a second lane: agents → tools, beside apps → models.
- Setup snippets: the endpoint URL and how to add it in Claude, Cursor, VS Code and other MCP clients.

## Phases

| Phase | What | Size |
|---|---|---|
| 1 (**built**) | **Create MCP servers on demand**: the MCP servers menu, create flow and per-server address (Streamable HTTP); APIs from OpenAPI; read tools; workloads with API keys; argument and result checks; case files; test console; pause and delete | 3–4 weeks |
| 2 (**built**) | People sign in through their identity provider (OAuth for MCP clients, federation per tenant); group access per server and tool; write tools with approval; draft, publish and versions; signed identity for backends; connector for on-premises APIs | 3–4 weeks |
| 3 | Put existing MCP servers behind Probaline (company-run and vendor-hosted), with the same checks; templates for common systems; injection classifier; on-behalf-of token exchange; end dates; isolated servers | 3–4 weeks |
| 4 | Find MCP use in the assessment: the collector looks for MCP servers and agent traffic in network and cloud logs, so the report says which agents already reach company data | 1–2 weeks |

Phase 1 alone is a useful product for companies' own agents. Phase 2 is the one to sell to a CISO.

### What phase 1 does today

- **Dashboard → MCP servers:** list, **Create MCP server**, and a page per server: address and setup for
  Claude Code, Cursor and VS Code; APIs added from an OpenAPI 3 description (JSON or YAML, pasted or uploaded);
  tools grouped by API (reads on; writes shown as "comes next"); a test console; access (every key with the
  `mcp` permission, or chosen keys), calls per minute, largest result, and personal-data removal.
- **Agents** connect over Streamable HTTP to `/mcp/<company>/<server>` with a Probaline API key that has the
  `mcp` permission. Drafts aren't reachable; paused servers answer "paused".
- **Every call:** arguments validated against the schema; the secrets check (a secret in arguments stops the
  call); company rules; the call with Probaline's own credential (bearer token or API key header, kept in the
  secret store), only to the registered address, no redirects, private addresses refused unless a self-hosted
  operator allows them; personal data removed from the result; instruction-like text flagged; size capped; a
  case file in Evidence ("An agent called … on …").
### What phase 2 adds

- **People sign in.** Dashboard → MCP servers → **Sign-in for people**: the company's OpenID Connect provider
  (Entra ID, Okta, Google or any other), its client ID and secret, and which ID-token claim holds groups.
  Each company gets its own OAuth issuer, `<gateway>/oauth/<company>`, with protected-resource and
  authorization-server metadata, dynamic client registration and client ID metadata documents, PKCE (S256)
  only, a consent page ("Claude Code wants to use HR self-service as you"), 15-minute access tokens for one
  server, and rotating refresh tokens (a reused one ends the sign-in). With `offline_access`, every refresh
  asks the identity provider again, so someone disabled there loses access within 15 minutes; otherwise at
  the end of the session length the admin sets.
- **Group access.** Each server lets nobody, everyone, or chosen groups sign in; each tool can be limited to
  groups (agents with API keys don't get group-limited tools). The tool list is filtered per person.
- **Write tools with approval.** Writes can be switched on; each needs a person's approval (the default) or
  runs straight away. A call that needs approval creates a request for that exact call (same caller, tool
  and arguments), waits up to the server's wait time for a decision, and otherwise tells the agent to ask
  again once approved. Approvals are used once. Approvers are named per server (any role, including plain
  users, who see only the Approvals page) or are the company's admins; nobody decides their own request. An
  optional webhook (Slack, Teams) is told when something waits; it gets a summary, never the arguments.
- **Draft, publish and versions.** Edits change a draft; agents see the published version until the next
  publish. Each publish is a numbered version with a note; any version can be restored as the draft.
  Credentials stay while any version uses them and go with the server.
- **Signed identity for backends.** Every call carries `X-Probaline-Identity`, a 5-minute ES256 token naming
  who asked (person and groups, or key), the server, the tool and the request, for that API only. APIs can
  check it with the key at `<gateway>/.well-known/jwks.json`; the verifier kit (`packages/verify-identity`:
  Node, Express, Fastify, an API Gateway Lambda authorizer and Python, tested; Go and Java, not yet) does it,
  with a report-only mode first. The Enforcement page fills it in for each API.
- **Connector.** A small container in the company network (`connector/`, no dependencies beyond Node) that
  connects out over HTTPS, collects calls for it, makes them only to its allowed hosts, never to cloud
  metadata addresses and never following redirects, and sends the answers back. Calls wait in the shared
  database encrypted (they carry the API's credential) and are deleted once answered.
- **Not yet:** rate limits shared across gateway instances (they're per instance); tool calls on the Gateway
  picture (they're on each server's page and in Evidence); SAML (OIDC only); Entra group overage (more than
  200 groups in a token); the identity provider's own consent screen for each client; email notifications
  for approvals; answers through a connector over 250 KB; key rotation for the gateway's signing key.

## Not in scope (for now)

- Hosting arbitrary MCP server code inside Probaline. Servers are configured, not programmed: we front APIs and
  existing MCP servers; we don't run customers' code.
- MCP over stdio. Probaline is a network service; agents reach it over HTTPS.
- Prompts and resources (MCP's other two primitives) beyond what tools need. Tools come first.

## Open questions

1. ~~Which identity provider to start with?~~ Generic OIDC, which covers Entra ID, Okta and Google.
2. ~~Approvals in the first version?~~ Reads only in phase 1; approvals came in phase 2.
3. Pricing: per tool call, per registered API, or included in the gateway plan?
4. Which MCP clients to test against first (Claude, ChatGPT, Cursor, VS Code Copilot), given how quickly their
   MCP support is changing.
