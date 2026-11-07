import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject, randomBytes, sign, verify } from 'crypto';

/**
 * Service-to-service calls inside Probaline. The gateway authenticates people and keys; when it asks an
 * internal service for something, it sends a short-lived token saying on whose behalf: the company, the user
 * and their role. The internal service trusts only that token, never addresses or headers, so a request for
 * one company can't read another's data even from inside the network.
 *
 * ES256. Only the signer holds a private key: the gateway, or an on-prem install's reporting agent with its
 * own. Internal services hold public keys only, so a compromised internal service can't make tokens. Each
 * trusted key says whose it is, and a reporting agent's key can only make reporting-agent tokens. Keys
 * carry an ID, so a new one can be trusted alongside the old while it's rotated.
 *
 *   INTERNAL_SIGNING_KEY  = {"iss":"gateway","privateKey":"-----BEGIN PRIVATE KEY-----…"}       (signers only)
 *   INTERNAL_TRUSTED_KEYS = [{"iss":"gateway","publicKey":"-----BEGIN PUBLIC KEY-----…"}, …]    (services)
 */

export interface InternalCaller {
  /** The company the request acts on. */
  tenantId: string;
  userId: string;
  /** The caller's role (platform_admin, tenant_admin, …, gateway, reporting_agent). */
  role: string;
  email?: string;
}

export type Issuer = 'gateway' | 'reporting-agent';
const ISSUERS: readonly Issuer[] = ['gateway', 'reporting-agent'];

export interface SigningKey { kid: string; iss: Issuer; privateKey: KeyObject }
export interface TrustedKey { kid: string; iss: Issuer; publicKey: KeyObject }

export class InternalAuthError extends Error {
  constructor(message: string) { super(message); this.name = 'InternalAuthError'; }
}

export const INTERNAL_HEADER = 'x-probaline-internal';
const TTL_SECONDS = 60;
const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** A key's ID: a fingerprint of its public half, so it never needs to be configured separately. */
export function kidOf(publicKey: KeyObject): string {
  return createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' })).digest('base64url').slice(0, 16);
}

function issuer(v: unknown): Issuer {
  if (!ISSUERS.includes(v as Issuer)) throw new InternalAuthError(`Unknown key owner "${String(v)}"`);
  return v as Issuer;
}

function ecP256(k: KeyObject): KeyObject {
  if (k.asymmetricKeyType !== 'ec' || k.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new InternalAuthError('Internal keys must be P-256 (ES256)');
  return k;
}

/** A new key pair, as the JSON the settings hold. For the key scripts and tests. */
export function newInternalKey(iss: Issuer): { signing: { iss: Issuer; privateKey: string }; trusted: { iss: Issuer; publicKey: string } } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    signing: { iss, privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string },
    trusted: { iss, publicKey: publicKey.export({ format: 'pem', type: 'spki' }) as string },
  };
}

export function signingKeyFrom(json: { iss: string; privateKey: string }): SigningKey {
  const privateKey = ecP256(createPrivateKey(json.privateKey));
  return { kid: kidOf(createPublicKey(privateKey)), iss: issuer(json.iss), privateKey };
}

export function trustedKeysFrom(json: Array<{ iss: string; publicKey: string }>): TrustedKey[] {
  if (!Array.isArray(json) || json.length === 0) throw new InternalAuthError('No trusted keys');
  return json.map((k) => { const publicKey = ecP256(createPublicKey(k.publicKey)); return { kid: kidOf(publicKey), iss: issuer(k.iss), publicKey }; });
}

const parsed = new Map<string, unknown>();
function fromEnv<T>(name: string, raw: string | undefined, make: (v: any) => T): T {
  if (!raw) throw new InternalAuthError(`${name} is not set`);
  const hit = parsed.get(raw);
  if (hit) return hit as T;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { throw new InternalAuthError(`${name} is not valid JSON`); }
  const made = make(v);
  parsed.set(raw, made);
  return made;
}

/** This service's signing key (the gateway, or a reporting agent). */
export const signingKeyFromEnv = (env: NodeJS.ProcessEnv = process.env): SigningKey =>
  fromEnv('INTERNAL_SIGNING_KEY', env.INTERNAL_SIGNING_KEY, signingKeyFrom);

/** The public keys this service accepts tokens from. */
export const trustedKeysFromEnv = (env: NodeJS.ProcessEnv = process.env): TrustedKey[] =>
  fromEnv('INTERNAL_TRUSTED_KEYS', env.INTERNAL_TRUSTED_KEYS, trustedKeysFrom);

export function signInternal(caller: InternalCaller, key: SigningKey, audience: string, now = Math.floor(Date.now() / 1000)): string {
  if (key.iss === 'reporting-agent' && caller.role !== 'reporting_agent') throw new InternalAuthError('A reporting agent key signs only reporting-agent requests');
  const head = b64(JSON.stringify({ alg: 'ES256', typ: 'probaline-internal', kid: key.kid }));
  const body = b64(JSON.stringify({
    iss: key.iss, aud: audience, tid: caller.tenantId, sub: caller.userId, role: caller.role,
    ...(caller.email ? { email: caller.email } : {}), iat: now, exp: now + TTL_SECONDS, jti: randomBytes(8).toString('hex'),
  }));
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64(sig)}`;
}

export function verifyInternal(token: string, trusted: TrustedKey[], audience: string, now = Math.floor(Date.now() / 1000)): InternalCaller {
  const parts = token.split('.');
  if (parts.length !== 3) throw new InternalAuthError('Malformed token');
  let head: any; let c: any;
  try {
    head = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { throw new InternalAuthError('Malformed token'); }
  if (head?.alg !== 'ES256' || head.typ !== 'probaline-internal') throw new InternalAuthError('Wrong token type');
  const key = trusted.find((k) => k.kid === head.kid);
  if (!key) throw new InternalAuthError('Unknown signing key');
  const ok = verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: key.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new InternalAuthError('Bad signature');
  // The key decides who signed, not the token.
  if (c.iss !== key.iss) throw new InternalAuthError('Token issuer does not match its key');
  if (c.aud !== audience) throw new InternalAuthError('Token is not for this service');
  if (typeof c.exp !== 'number' || c.exp < now - 5 || typeof c.iat !== 'number' || c.iat > now + 30) throw new InternalAuthError('Token expired');
  if (typeof c.tid !== 'string' || !c.tid || typeof c.sub !== 'string' || typeof c.role !== 'string') throw new InternalAuthError('Token is incomplete');
  if (key.iss === 'reporting-agent' && c.role !== 'reporting_agent') throw new InternalAuthError('A reporting agent may act only as itself');
  return { tenantId: c.tid, userId: c.sub, role: c.role, ...(typeof c.email === 'string' ? { email: c.email } : {}) };
}
