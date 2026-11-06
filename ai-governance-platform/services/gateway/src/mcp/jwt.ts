import { createPublicKey, createSign, createVerify, JsonWebKey, KeyObject, constants } from 'crypto';

/**
 * JSON Web Tokens, signed and checked with Node's own crypto. Only asymmetric algorithms are accepted:
 * `none` and shared-secret (HS*) tokens are always refused, so a public key can never be used as a secret.
 */

export class JwtError extends Error {
  constructor(message: string) { super(message); this.name = 'JwtError'; }
}

export type Alg = 'RS256' | 'RS384' | 'RS512' | 'PS256' | 'ES256' | 'ES384';
const ALGS: Record<Alg, { hash: string; ec?: boolean; pss?: boolean }> = {
  RS256: { hash: 'sha256' }, RS384: { hash: 'sha384' }, RS512: { hash: 'sha512' }, PS256: { hash: 'sha256', pss: true },
  ES256: { hash: 'sha256', ec: true }, ES384: { hash: 'sha384', ec: true },
};

const b64 = (v: Buffer | string) => Buffer.from(v).toString('base64url');
const json = (part: string) => {
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch { throw new JwtError('Malformed token'); }
};

export interface JwtHeader { alg: string; kid?: string; typ?: string }
export type Claims = Record<string, unknown> & { iss?: string; sub?: string; aud?: string | string[]; exp?: number; nbf?: number; iat?: number };

export function signJwt(header: { alg: Alg; kid: string; typ?: string }, claims: Claims, key: KeyObject): string {
  const spec = ALGS[header.alg];
  const input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
  const signature = createSign(spec.hash).update(input).sign({ key, ...(spec.ec ? { dsaEncoding: 'ieee-p1363' as const } : {}), ...(spec.pss ? { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } : {}) });
  return `${input}.${b64(signature)}`;
}

/** Read a token's header and claims without checking it (to find the key, or the issuer). */
export function decodeJwt(token: string): { header: JwtHeader; claims: Claims } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('Malformed token');
  return { header: json(parts[0]), claims: json(parts[1]) };
}

export interface VerifyOptions {
  /** Find the public key for this header (by kid). Return null if unknown. */
  key: (header: JwtHeader) => Promise<KeyObject | null> | KeyObject | null;
  issuer: string;
  /** The token's audience must include one of these. */
  audience: string | string[];
  typ?: string;
  algorithms?: Alg[];
  /** Seconds of clock difference to allow. */
  skew?: number;
  now?: number;
}

export async function verifyJwt(token: string, o: VerifyOptions): Promise<Claims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('Malformed token');
  const { header, claims } = decodeJwt(token);
  const allowed = o.algorithms ?? (Object.keys(ALGS) as Alg[]);
  if (!allowed.includes(header.alg as Alg)) throw new JwtError(`Algorithm ${header.alg} is not accepted`);
  if (o.typ && header.typ !== o.typ) throw new JwtError('Wrong token type');
  const key = await o.key(header);
  if (!key) throw new JwtError('Unknown signing key');
  const spec = ALGS[header.alg as Alg];
  if (!!spec.ec !== (key.asymmetricKeyType === 'ec')) throw new JwtError('Key does not match the algorithm');
  const ok = createVerify(spec.hash).update(`${parts[0]}.${parts[1]}`).verify(
    { key, ...(spec.ec ? { dsaEncoding: 'ieee-p1363' as const } : {}), ...(spec.pss ? { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_AUTO } : {}) },
    Buffer.from(parts[2], 'base64url'),
  );
  if (!ok) throw new JwtError('Bad signature');

  const now = o.now ?? Math.floor(Date.now() / 1000);
  const skew = o.skew ?? 60;
  if (claims.iss !== o.issuer) throw new JwtError('Wrong issuer');
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const wanted = Array.isArray(o.audience) ? o.audience : [o.audience];
  if (!auds.some((a) => typeof a === 'string' && wanted.includes(a))) throw new JwtError('Wrong audience');
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) throw new JwtError('Token expired');
  if (typeof claims.nbf === 'number' && claims.nbf - skew > now) throw new JwtError('Token not valid yet');
  return claims;
}

/** A public key from a JWKS entry. */
export function keyFromJwk(jwk: JsonWebKey): KeyObject {
  return createPublicKey({ key: jwk, format: 'jwk' });
}
