import { createHash, createPrivateKey, createPublicKey, KeyObject, sign as signRaw, verify as verifyRaw } from 'crypto';
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { TRUSTED_LICENSE_KEYS } from './trusted-keys';

/**
 * The license file a customer-run Probaline checks by itself, never contacting us (docs/HYBRID.md):
 *
 *   PBL1.<payload>.<signature>        payload: base64url JSON; signature: ECDSA P-256 / SHA-256, DER, base64url,
 *                                     over the ASCII text "PBL1.<payload>"
 *
 * We sign with a key held in AWS KMS (its private half never leaves KMS). The gateway verifies against the public
 * keys compiled into the image (trusted-keys.ts). They are deliberately not configurable: if an install could set
 * its own key, it could sign its own licenses.
 */

export const LICENSE_PREFIX = 'PBL1';

export interface LicenseClaims {
  v: 1;
  /** License ID, shown to the customer and in our records. */
  id: string;
  /** Which of our keys signed it. */
  kid: string;
  /** The customer, as we know them. */
  customer: string;
  tenantId: string;
  plan: 'starter' | 'professional' | 'enterprise';
  maxUsers: number;
  /** The gateway's address(es): the hostnames it may serve (one gateway, perhaps an internal and an external name). */
  addresses: string[];
  issuedAt: string;
  endsAt: string;
}

export class LicenseFileError extends Error {
  constructor(message: string, public code: 'MALFORMED' | 'UNKNOWN_KEY' | 'BAD_SIGNATURE') { super(message); }
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
export const kidOf = (key: KeyObject) => createHash('sha256').update(key.export({ format: 'der', type: 'spki' })).digest('hex').slice(0, 16);

/** A hostname as the gateway compares it: lower case, no port, no trailing dot. */
export const normalizeAddress = (host: string) => host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');

// ── Verifying (the gateway) ─────────────────────────────────────────────────────────────────────────────────────

let trusted: Array<{ kid: string; key: KeyObject; label: string }> | null = null;
const trustedKeys = () => (trusted ??= TRUSTED_LICENSE_KEYS.map((k) => { const key = createPublicKey(k.publicKey); return { kid: kidOf(key), key, label: k.label }; }));

/** Tests only: trust these keys instead of the compiled-in ones. Not reachable from configuration. */
export function trustLicenseKeysForTests(keys: Array<{ publicKey: string; label: string }> | null) {
  trusted = keys ? keys.map((k) => { const key = createPublicKey(k.publicKey); return { kid: kidOf(key), key, label: k.label }; }) : null;
}

/** The license's claims, if it's well formed and signed by one of our keys; throws otherwise. Dates are not judged here. */
export function verifyLicenseFile(text: string): LicenseClaims {
  const parts = text.trim().split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) throw new LicenseFileError('That isn’t a Probaline license file. Check it was copied in full.', 'MALFORMED');
  let claims: LicenseClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new LicenseFileError('That license file is damaged. Check it was copied in full.', 'MALFORMED');
  }
  const key = trustedKeys().find((k) => k.kid === claims?.kid);
  if (!key) throw new LicenseFileError('That license wasn’t issued by Probaline.', 'UNKNOWN_KEY');
  const ok = verifyRaw('sha256', Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'), { key: key.key, dsaEncoding: 'der' }, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new LicenseFileError('That license file has been changed or damaged, so it can’t be used.', 'BAD_SIGNATURE');
  if (claims.v !== 1 || !claims.id || !claims.endsAt || !Array.isArray(claims.addresses) || claims.addresses.length === 0 || Number.isNaN(Date.parse(claims.endsAt))) {
    throw new LicenseFileError('That license file is from a newer or unknown version.', 'MALFORMED');
  }
  return { ...claims, addresses: claims.addresses.map(normalizeAddress) };
}

// ── Signing (our platform) ──────────────────────────────────────────────────────────────────────────────────────

export interface LicenseSigner {
  /** The kid of the key that signs, so the gateway can find its public half. */
  kid(): Promise<string>;
  sign(data: Buffer): Promise<Buffer>;
}

/** Our production signer: the private key stays in KMS (an ECC_NIST_P256 SIGN_VERIFY key). */
export class KmsLicenseSigner implements LicenseSigner {
  private client = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });
  constructor(private keyId: string, private publicKeyPem?: string) {}
  async kid() {
    if (!this.publicKeyPem) {
      const { GetPublicKeyCommand } = await import('@aws-sdk/client-kms');
      const out = await this.client.send(new GetPublicKeyCommand({ KeyId: this.keyId }));
      this.publicKeyPem = createPublicKey({ key: Buffer.from(out.PublicKey!), format: 'der', type: 'spki' }).export({ format: 'pem', type: 'spki' }) as string;
    }
    return kidOf(createPublicKey(this.publicKeyPem));
  }
  async sign(data: Buffer) {
    // KMS signs at most 4 KB of raw data; sign the SHA-256 digest instead (the same ECDSA_SHA_256 signature).
    const out = await this.client.send(new SignCommand({ KeyId: this.keyId, Message: createHash('sha256').update(data).digest(), MessageType: 'DIGEST', SigningAlgorithm: 'ECDSA_SHA_256' }));
    return Buffer.from(out.Signature!);
  }
}

/** Local development and tests: a PEM private key. */
export class LocalLicenseSigner implements LicenseSigner {
  private key: KeyObject;
  constructor(privateKeyPem: string) { this.key = createPrivateKey(privateKeyPem); }
  async kid() { return kidOf(createPublicKey(this.key)); }
  async sign(data: Buffer) { return signRaw('sha256', data, { key: this.key, dsaEncoding: 'der' }); }
}

/** The signer this deployment issues with, or null when it can't issue license files. */
export function licenseSignerFromEnv(): LicenseSigner | null {
  if (process.env.LICENSE_SIGNING_KMS_KEY_ID) return new KmsLicenseSigner(process.env.LICENSE_SIGNING_KMS_KEY_ID);
  if (process.env.LICENSE_SIGNING_KEY && process.env.NODE_ENV !== 'production') return new LocalLicenseSigner(process.env.LICENSE_SIGNING_KEY);
  return null;
}

export async function signLicenseFile(claims: Omit<LicenseClaims, 'v' | 'kid'>, signer: LicenseSigner): Promise<string> {
  const full: LicenseClaims = { v: 1, kid: await signer.kid(), ...claims, addresses: claims.addresses.map(normalizeAddress) };
  const head = `${LICENSE_PREFIX}.${b64url(JSON.stringify(full))}`;
  return `${head}.${b64url(await signer.sign(Buffer.from(head, 'ascii')))}`;
}
