import { createHash, createPublicKey, KeyObject, verify as verifyRaw } from 'crypto';
import { CatalogData } from '@ai-governance/catalog';
import { TRUSTED_CATALOG_KEYS } from './trusted-keys';

/**
 * A published AI service catalog, as installs download it (docs/ASSESSMENT.md, "The AI service catalog"):
 *
 *   { "format": "probaline.catalog/1", "kid": "<key id>", "payload": "<base64url JSON>", "signature": "<base64url>" }
 *
 * The payload is CatalogData. The signature is ECDSA P-256 / SHA-256 (DER) over the ASCII text
 * "probaline.catalog/1.<payload>", so a signature made for anything else (a license file) never verifies here.
 */

export const CATALOG_FORMAT = 'probaline.catalog/1';
/** A published catalog is a few hundred kilobytes; refuse anything far larger before parsing it. */
export const MAX_CATALOG_BYTES = 8 * 1024 * 1024;

export interface SignedCatalog {
  format: typeof CATALOG_FORMAT;
  kid: string;
  payload: string;
  signature: string;
}

export class CatalogDocumentError extends Error {
  constructor(message: string, public code: 'MALFORMED' | 'UNKNOWN_KEY' | 'BAD_SIGNATURE' | 'TOO_LARGE') { super(message); }
}

export const kidOf = (key: KeyObject) => createHash('sha256').update(key.export({ format: 'der', type: 'spki' })).digest('hex').slice(0, 16);

type Trusted = { kid: string; key: KeyObject; label: string };
let testKeys: Trusted[] | null = null;

/** Compiled-in keys, plus any the install adds in CATALOG_TRUSTED_KEYS (PEM public keys, one after another). */
function trustedKeys(): Trusted[] {
  if (testKeys) return testKeys;
  const extra = (process.env.CATALOG_TRUSTED_KEYS ?? '').match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g) ?? [];
  return [...TRUSTED_CATALOG_KEYS, ...extra.map((publicKey, i) => ({ publicKey, label: `CATALOG_TRUSTED_KEYS #${i + 1}` }))].flatMap((k) => {
    try {
      const key = createPublicKey(k.publicKey);
      return [{ kid: kidOf(key), key, label: k.label }];
    } catch {
      return [];
    }
  });
}

/** Tests only: trust these keys instead. */
export function trustCatalogKeysForTests(keys: Array<{ publicKey: string; label: string }> | null) {
  testKeys = keys ? keys.map((k) => { const key = createPublicKey(k.publicKey); return { kid: kidOf(key), key, label: k.label }; }) : null;
}

export const signedText = (payload: string) => Buffer.from(`${CATALOG_FORMAT}.${payload}`, 'ascii');

/** The catalog a signed document carries, if it's well formed and signed by a trusted key; throws otherwise. */
export function verifyCatalogDocument(text: string): { data: CatalogData; kid: string; keyLabel: string } {
  if (Buffer.byteLength(text) > MAX_CATALOG_BYTES) throw new CatalogDocumentError('That catalog file is too large to be a Probaline catalog.', 'TOO_LARGE');
  let doc: SignedCatalog;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new CatalogDocumentError('That isn’t a Probaline catalog file. Check it was downloaded in full.', 'MALFORMED');
  }
  if (!doc || doc.format !== CATALOG_FORMAT || typeof doc.payload !== 'string' || typeof doc.signature !== 'string' || typeof doc.kid !== 'string') {
    throw new CatalogDocumentError('That isn’t a Probaline catalog file, or it’s from a newer version.', 'MALFORMED');
  }
  const key = trustedKeys().find((k) => k.kid === doc.kid);
  if (!key) throw new CatalogDocumentError('That catalog wasn’t signed by a key this install trusts.', 'UNKNOWN_KEY');
  const ok = verifyRaw('sha256', signedText(doc.payload), { key: key.key, dsaEncoding: 'der' }, Buffer.from(doc.signature, 'base64url'));
  if (!ok) throw new CatalogDocumentError('That catalog has been changed or damaged since it was signed, so it can’t be used.', 'BAD_SIGNATURE');
  let data: CatalogData;
  try {
    data = JSON.parse(Buffer.from(doc.payload, 'base64url').toString('utf8'));
  } catch {
    throw new CatalogDocumentError('That catalog’s contents are damaged.', 'MALFORMED');
  }
  return { data, kid: doc.kid, keyLabel: key.label };
}

/** Sign a catalog (our publishing script, and tests). `sign` returns a DER ECDSA P-256 / SHA-256 signature. */
export async function signCatalogDocument(data: CatalogData, kid: string, sign: (bytes: Buffer) => Promise<Buffer> | Buffer): Promise<SignedCatalog> {
  const payload = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const signature = Buffer.from(await sign(signedText(payload))).toString('base64url');
  return { format: CATALOG_FORMAT, kid, payload, signature };
}
