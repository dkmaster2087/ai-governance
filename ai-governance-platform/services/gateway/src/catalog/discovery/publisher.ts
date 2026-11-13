import fs from 'fs';
import { createPrivateKey, createPublicKey, KeyObject, sign as signRaw } from 'crypto';
import { KMSClient, GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms';
import { AiServiceData, BUILT_IN_SEQUENCE, CatalogData, builtInCatalogData, servicesFromData } from '@ai-governance/catalog';
import { createLogger } from '@ai-governance/utils';
import { kidOf, signCatalogDocument, trustCatalogKeyAtRuntime } from '../catalog-document';
import { catalogUpdater } from '../catalog-updater';
import { Published, work } from './catalog-work';

const logger = createLogger('gateway:catalog-publisher');

/**
 * Cloud publishes the AI service catalog every install downloads: the list built into this version, plus services
 * people approved on the Catalog page and advisories, signed with our KMS key (CATALOG_SIGNING_KMS_KEY_ID; a key file
 * locally, CATALOG_SIGNING_KEY_FILE). Served at /public/catalog/v1/latest.json. Only an install with
 * CATALOG_PUBLISHER=on publishes; customer installs never do.
 */
export const isPublisher = () => (process.env.CATALOG_PUBLISHER ?? '').toLowerCase() === 'on';

export interface CatalogSigner { kid(): Promise<string>; publicKeyPem(): Promise<string>; sign(bytes: Buffer): Promise<Buffer> }

class KmsSigner implements CatalogSigner {
  private kms = new KMSClient({});
  private pub: KeyObject | null = null;
  constructor(private keyId: string) {}
  private async key() {
    if (!this.pub) {
      const res = await this.kms.send(new GetPublicKeyCommand({ KeyId: this.keyId }));
      this.pub = createPublicKey({ key: Buffer.from(res.PublicKey!), format: 'der', type: 'spki' });
    }
    return this.pub;
  }
  async kid() { return kidOf(await this.key()); }
  async publicKeyPem() { return (await this.key()).export({ format: 'pem', type: 'spki' }) as string; }
  async sign(bytes: Buffer) {
    const res = await this.kms.send(new SignCommand({ KeyId: this.keyId, Message: bytes, MessageType: 'RAW', SigningAlgorithm: 'ECDSA_SHA_256' }));
    return Buffer.from(res.Signature!);
  }
}

export class KeyFileSigner implements CatalogSigner {
  private key: KeyObject;
  constructor(pem: string) { this.key = createPrivateKey(pem); }
  async kid() { return kidOf(createPublicKey(this.key)); }
  async publicKeyPem() { return createPublicKey(this.key).export({ format: 'pem', type: 'spki' }) as string; }
  async sign(bytes: Buffer) { return signRaw('sha256', bytes, { key: this.key, dsaEncoding: 'der' }); }
}

let signerOverride: CatalogSigner | null = null;
export const setCatalogSigner = (s: CatalogSigner | null) => { signerOverride = s; };
function signer(): CatalogSigner {
  if (signerOverride) return signerOverride;
  if (process.env.CATALOG_SIGNING_KMS_KEY_ID) return (signerOverride = new KmsSigner(process.env.CATALOG_SIGNING_KMS_KEY_ID));
  if (process.env.CATALOG_SIGNING_KEY_FILE) return (signerOverride = new KeyFileSigner(fs.readFileSync(process.env.CATALOG_SIGNING_KEY_FILE, 'utf8')));
  throw new Error('No catalog signing key: set CATALOG_SIGNING_KMS_KEY_ID (or CATALOG_SIGNING_KEY_FILE locally)');
}

/** The catalog as it would be published now: built in, then reviewed services (replacing by id), then advisories. */
export async function draftCatalog(sequence: number, version: string, publishedAt: string, change?: (services: Map<string, AiServiceData>) => void): Promise<CatalogData> {
  const services = new Map(builtInCatalogData(sequence, version, publishedAt).services.map((s) => [s.id, s] as const));
  for (const r of await work.services()) services.set(r.service.id, r.service);
  change?.(services);
  const data: CatalogData = {
    sequence, version, publishedAt,
    services: [...services.values()],
    advisories: (await work.advisories()).map((a) => a.advisory),
  };
  servicesFromData(data); // throws on anything an install would refuse
  return data;
}

/** Sign and store a new edition, and use it on this copy straight away. */
export async function publishCatalog(by: string): Promise<Published> {
  const prev = await work.published();
  const now = new Date();
  const sequence = Math.max(Math.floor(now.getTime() / 1000), (prev?.sequence ?? 0) + 1, BUILT_IN_SEQUENCE + 1);
  const at = new Date(sequence * 1000).toISOString();
  const version = `${at.slice(0, 10)}.${at.slice(11, 13)}${at.slice(14, 16)}${at.slice(17, 19)}`;
  const data = await draftCatalog(sequence, version, at);
  const s = signer();
  const kid = await s.kid();
  trustCatalogKeyAtRuntime(await s.publicKeyPem(), 'publisher (KMS)');
  const document = JSON.stringify(await signCatalogDocument(data, kid, (bytes) => s.sign(bytes)));
  const published: Published = { document, sequence, version, publishedAt: at, services: data.services.length, by };
  await work.putPublished(published);
  await catalogUpdater().accept(document, 'feed').catch((err) => logger.warn('Published catalog not applied here', { error: (err as Error).message }));
  logger.info('AI service catalog published', { version, services: data.services.length, by });
  return published;
}

/** On start: publish if nothing is published yet, or if this version's built-in list is newer than the published one. */
export async function ensurePublished(): Promise<void> {
  if (!isPublisher()) return;
  try {
    const prev = await work.published();
    if (!prev || prev.sequence < BUILT_IN_SEQUENCE) await publishCatalog('Probaline (new version)');
    else {
      const s = signer();
      trustCatalogKeyAtRuntime(await s.publicKeyPem(), 'publisher (KMS)');
      await catalogUpdater().accept(prev.document, 'feed').catch(() => undefined);
    }
  } catch (err) {
    logger.error('Could not publish the AI service catalog', { error: (err as Error).message });
  }
}
