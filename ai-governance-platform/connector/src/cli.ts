#!/usr/bin/env node
import { Connector, VERSION } from './connector';

/**
 * probaline-connector, configured by environment:
 *   PROBALINE_URL               the gateway's address (https)
 *   PROBALINE_CONNECTOR_TOKEN   the token shown when the connector was created in the dashboard
 *   CONNECTOR_ALLOWED_HOSTS     optional, comma-separated: narrow the hosts it calls (on top of the dashboard's list)
 *   CONNECTOR_CONCURRENCY       optional, calls at once (default 8)
 * Trust a company CA with NODE_EXTRA_CA_CERTS=/path/to/ca.pem; use a proxy with HTTPS_PROXY (Node 24+) or the network's routing.
 */
function main() {
  if (process.argv.includes('--version')) { console.log(VERSION); return; }
  const gatewayUrl = process.env.PROBALINE_URL ?? '';
  const token = process.env.PROBALINE_CONNECTOR_TOKEN ?? '';
  if (!gatewayUrl || !token) {
    console.error('Set PROBALINE_URL and PROBALINE_CONNECTOR_TOKEN (Dashboard → MCP servers → Connectors).');
    process.exit(2);
  }
  if (!gatewayUrl.startsWith('https://') && process.env.CONNECTOR_ALLOW_HTTP !== 'true') {
    console.error('PROBALINE_URL must use https.');
    process.exit(2);
  }
  const connector = new Connector({
    gatewayUrl, token,
    localAllowedHosts: (process.env.CONNECTOR_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    concurrency: Number(process.env.CONNECTOR_CONCURRENCY) || 8,
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => connector.stop());
  connector.run().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
}

main();
