# Probaline connector

Lets Probaline in the cloud reach APIs inside your network, so they can be offered as MCP tools, with no
inbound firewall change. The connector opens outbound HTTPS connections to the gateway, collects the calls
waiting for it, makes them inside your network and sends the answers back.

- Calls only the hosts allowed for it in the dashboard (and, if you set `CONNECTOR_ALLOWED_HOSTS`, only those
  that are on both lists). Never calls cloud metadata addresses. Never follows redirects.
- Keeps nothing on disk. Logs the host, method, status and timing of each call, never paths, headers or bodies.
- No dependencies beyond Node 20.

## Run it

Create a connector in the dashboard (MCP servers → Connectors). Copy the token: it's shown once.

```bash
docker run -d --name probaline-connector --restart unless-stopped \
  -e PROBALINE_URL=https://<your gateway> \
  -e PROBALINE_CONNECTOR_TOKEN=<token> \
  probaline/connector:0.1.0
```

The image is the connector compiled to bytecode on a minimal (distroless) Node image: no shell, no source,
not root. For `NODE_EXTRA_CA_CERTS`, mount the CA file read-only, e.g. `-v /etc/acme-ca.pem:/ca.pem:ro -e
NODE_EXTRA_CA_CERTS=/ca.pem`.

### Check the image before you run it

Each release is signed by Probaline's release workflow, with a software bill of materials attached:

```bash
cosign verify probaline/connector:0.1.0 \
  --certificate-identity-regexp 'https://github.com/dkmaster2087/ai-governance/.github/workflows/release-agents.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
cosign verify-attestation --type spdxjson probaline/connector:0.1.0 \
  --certificate-identity-regexp 'https://github.com/dkmaster2087/ai-governance/.github/workflows/release-agents.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The same image is at `ghcr.io/dkmaster2087/probaline-connector:0.1.0`.

| Setting | |
|---|---|
| `PROBALINE_URL` | The gateway's address (https) |
| `PROBALINE_CONNECTOR_TOKEN` | The connector's token |
| `CONNECTOR_ALLOWED_HOSTS` | Optional, comma-separated: hosts this copy may call, on top of the dashboard's list |
| `CONNECTOR_CONCURRENCY` | Optional, calls at once (default 8) |
| `NODE_EXTRA_CA_CERTS` | Optional, your company CA, for APIs with internal certificates |

Run two copies for resilience: each call goes to whichever copy collects it first.

## Limits (beta)

Answers through a connector are capped at 250 KB. Calls wait in the gateway's database (encrypted) for at
most a few seconds while the connector collects them, so each call adds a little latency.

## Releases

Set the new version in `package.json` and `src/connector.ts`, then push a tag `connector-v<version>`. The
Release workflow (`.github/workflows/release-agents.yml`) checks the versions agree, builds the image, checks
nothing readable is in it, and publishes it signed. Build it yourself from the platform folder with
`docker build -f connector/Dockerfile -t probaline/connector:0.1.0 .`.
