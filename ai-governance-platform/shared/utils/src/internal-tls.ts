import https from 'https';
import type { TLSSocket } from 'tls';

/**
 * Mutual TLS between Probaline's services. Every internal call is encrypted, and each side proves which
 * service it is with a certificate from the install's own CA (scripts/internal-pki.mjs). The certificate
 * says which service is calling; the signed token (internal-auth.ts) still says for which company.
 *
 *   INTERNAL_TLS_CA, INTERNAL_TLS_CERT, INTERNAL_TLS_KEY: PEM text. All three, or none (plain HTTP, tests only).
 */

export interface InternalTls { ca: string; cert: string; key: string }

export class InternalTlsError extends Error {
  constructor(message: string) { super(message); this.name = 'InternalTlsError'; }
}

export function internalTlsFromEnv(env: NodeJS.ProcessEnv = process.env): InternalTls | null {
  const { INTERNAL_TLS_CA: ca, INTERNAL_TLS_CERT: cert, INTERNAL_TLS_KEY: key } = env;
  if (!ca && !cert && !key) return null;
  if (!ca || !cert || !key) throw new InternalTlsError('Set INTERNAL_TLS_CA, INTERNAL_TLS_CERT and INTERNAL_TLS_KEY together');
  return { ca, cert, key };
}

/** For an internal service's server: ask every caller for a certificate; the guard decides who may proceed. */
export function tlsServerOptions(tls: InternalTls) {
  return { ca: tls.ca, cert: tls.cert, key: tls.key, requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.2' as const };
}

/** The calling service's name, from a certificate the install's CA signed; null otherwise. */
export function peerService(socket: unknown): string | null {
  const s = socket as Partial<TLSSocket> | undefined;
  if (!s || typeof s.getPeerCertificate !== 'function' || !s.authorized) return null;
  const cn = s.getPeerCertificate().subject?.CN;
  return typeof cn === 'string' && cn ? cn : null;
}

const agents = new Map<string, https.Agent>();
/** For a caller: presents this service's certificate and trusts only the install's CA. */
export function internalHttpsAgent(tls: InternalTls | null = internalTlsFromEnv()): https.Agent | undefined {
  if (!tls) return undefined;
  const id = tls.cert;
  let a = agents.get(id);
  if (!a) {
    a = new https.Agent({ ca: tls.ca, cert: tls.cert, key: tls.key, keepAlive: true, minVersion: 'TLSv1.2' });
    agents.set(id, a);
  }
  return a;
}
