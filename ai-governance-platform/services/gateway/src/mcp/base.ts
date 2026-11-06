import { FastifyRequest } from 'fastify';

/**
 * The gateway's public address, as agents and identity providers see it. Set PUBLIC_GATEWAY_URL in every
 * deployment that lets people sign in to MCP servers: OAuth addresses must not depend on request headers.
 * Without it (local development), it's taken from the request.
 */
export function publicBase(request?: FastifyRequest): string {
  const configured = process.env.PUBLIC_GATEWAY_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (!request) return 'http://localhost:3000';
  return `${request.protocol}://${request.headers.host ?? 'localhost:3000'}`;
}

/** The address of one MCP server, which is also the OAuth resource its tokens are for. */
export const serverResource = (base: string, tenantId: string, serverId: string) => `${base}/mcp/${tenantId}/${serverId}`;

/** The OAuth issuer for one company: each company signs in through its own identity provider. */
export const issuerFor = (base: string, tenantId: string) => `${base}/oauth/${tenantId}`;
