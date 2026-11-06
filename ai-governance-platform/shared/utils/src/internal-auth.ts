import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Service-to-service calls inside Probaline. The gateway authenticates people and keys; when it asks an
 * internal service (analytics) for something, it sends a short-lived token saying on whose behalf: the
 * company, the user and their role. The internal service trusts only that token, never addresses or
 * headers, so a request for one company can't read another's data even from inside the network.
 *
 * HS256 with a key only the two services hold (INTERNAL_SERVICE_KEY, from the secret store in AWS).
 */

export interface InternalCaller {
  /** The company the request acts on. */
  tenantId: string;
  userId: string;
  /** The caller's dashboard role (platform_admin, tenant_admin, tenant_auditor, tenant_user). */
  role: string;
  email?: string;
}

export class InternalAuthError extends Error {
  constructor(message: string) { super(message); this.name = 'InternalAuthError'; }
}

export const INTERNAL_HEADER = 'x-probaline-internal';
const TTL_SECONDS = 60;
const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** The key from the environment, checked to be long enough. */
export function internalKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.INTERNAL_SERVICE_KEY ?? '';
  if (key.length < 32) throw new InternalAuthError('INTERNAL_SERVICE_KEY must be set to at least 32 characters');
  return key;
}

export function signInternal(caller: InternalCaller, key: string, audience: string, now = Math.floor(Date.now() / 1000)): string {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'probaline-internal' }));
  const body = b64(JSON.stringify({
    iss: 'gateway', aud: audience, tid: caller.tenantId, sub: caller.userId, role: caller.role,
    ...(caller.email ? { email: caller.email } : {}), iat: now, exp: now + TTL_SECONDS, jti: randomBytes(8).toString('hex'),
  }));
  const sig = createHmac('sha256', key).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyInternal(token: string, key: string, audience: string, now = Math.floor(Date.now() / 1000)): InternalCaller {
  const parts = token.split('.');
  if (parts.length !== 3) throw new InternalAuthError('Malformed token');
  const expected = createHmac('sha256', key).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new InternalAuthError('Bad signature');
  let head: any; let c: any;
  try {
    head = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { throw new InternalAuthError('Malformed token'); }
  if (head.alg !== 'HS256' || head.typ !== 'probaline-internal') throw new InternalAuthError('Wrong token type');
  if (c.iss !== 'gateway' || c.aud !== audience) throw new InternalAuthError('Token is not for this service');
  if (typeof c.exp !== 'number' || c.exp < now - 5 || typeof c.iat !== 'number' || c.iat > now + 30) throw new InternalAuthError('Token expired');
  if (typeof c.tid !== 'string' || !c.tid || typeof c.sub !== 'string' || typeof c.role !== 'string') throw new InternalAuthError('Token is incomplete');
  return { tenantId: c.tid, userId: c.sub, role: c.role, ...(typeof c.email === 'string' ? { email: c.email } : {}) };
}
