import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, JsonWebKey, KeyObject, randomBytes } from 'crypto';
import {
  CreateSecretCommand, GetSecretValueCommand, ResourceExistsException, ResourceNotFoundException, SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { Alg, Claims, signJwt } from './jwt';

/**
 * The gateway's own keys for MCP: one signing key (ES256) for the access tokens it gives agents and the
 * identity statements it sends to company APIs, and one encryption key for refresh tokens it keeps from
 * identity providers. Both live in the secret store, created once by whichever gateway instance gets there
 * first; every instance then uses the same ones.
 */

export interface KeyVault {
  /** Read the secret with this name, or create it with `make()` if there is none. Never overwrites. */
  getOrCreate(name: string, make: () => string): Promise<string>;
}

export class SecretsManagerVault implements KeyVault {
  private client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

  async getOrCreate(name: string, make: () => string): Promise<string> {
    const read = async () => (await this.client.send(new GetSecretValueCommand({ SecretId: name }))).SecretString!;
    try {
      return await read();
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException)) throw err;
    }
    try {
      const value = make();
      await this.client.send(new CreateSecretCommand({ Name: name, SecretString: value, KmsKeyId: process.env.PROVIDER_KEYS_KMS_KEY_ID || undefined, Tags: [{ Key: 'kind', Value: 'mcp-gateway-keys' }] }));
      return value;
    } catch (err) {
      // Another instance created it first: use theirs.
      if (err instanceof ResourceExistsException) return read();
      throw err;
    }
  }
}

export class MemoryVault implements KeyVault {
  private values = new Map<string, string>();
  async getOrCreate(name: string, make: () => string) {
    if (!this.values.has(name)) this.values.set(name, make());
    return this.values.get(name)!;
  }
}

interface Bundle { kid: string; privateJwk: JsonWebKey; encKey: string }

function newBundle(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const privateJwk = privateKey.export({ format: 'jwk' });
  const kid = createHash('sha256').update(JSON.stringify({ crv: privateJwk.crv, kty: privateJwk.kty, x: privateJwk.x, y: privateJwk.y })).digest('base64url').slice(0, 16);
  return JSON.stringify({ kid, privateJwk, encKey: randomBytes(32).toString('base64') } satisfies Bundle);
}

export class GatewayKeys {
  private loaded?: Promise<{ kid: string; privateKey: KeyObject; publicKey: KeyObject; publicJwk: JsonWebKey; encKey: Buffer }>;

  constructor(
    private vault: KeyVault = new SecretsManagerVault(),
    private name = `${process.env.PROVIDER_KEYS_SECRET_PREFIX || `probaline/${process.env.STAGE || 'dev'}/provider-keys`}/mcp/gateway-keys`,
  ) {}

  private load() {
    this.loaded ??= this.vault.getOrCreate(this.name, newBundle).then((raw) => {
      const b = JSON.parse(raw) as Bundle;
      const privateKey = createPrivateKey({ key: b.privateJwk, format: 'jwk' });
      const publicKey = createPublicKey(privateKey);
      const { kty, crv, x, y } = publicKey.export({ format: 'jwk' });
      return { kid: b.kid, privateKey, publicKey, publicJwk: { kty, crv, x, y, kid: b.kid, use: 'sig', alg: 'ES256' }, encKey: Buffer.from(b.encKey, 'base64') };
    }).catch((err) => { this.loaded = undefined; throw err; });
    return this.loaded;
  }

  async sign(claims: Claims, typ: string): Promise<string> {
    const k = await this.load();
    return signJwt({ alg: 'ES256' as Alg, kid: k.kid, typ }, claims, k.privateKey);
  }

  /** The public key for a kid (only ours). */
  async publicKey(kid?: string): Promise<KeyObject | null> {
    const k = await this.load();
    return kid === k.kid ? k.publicKey : null;
  }

  /** Published at /.well-known/jwks.json so company APIs can check what Probaline signs. */
  async jwks() {
    return { keys: [(await this.load()).publicJwk] };
  }

  async encrypt(plain: string): Promise<string> {
    const { encKey } = await this.load();
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', encKey, iv);
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
  }

  async decrypt(sealed: string): Promise<string> {
    const { encKey } = await this.load();
    const [iv, tag, data] = sealed.split('.').map((s) => Buffer.from(s, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', encKey, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  }
}

let shared: GatewayKeys | null = null;
export const gatewayKeys = () => (shared ??= new GatewayKeys());
export const setGatewayKeys = (k: GatewayKeys | null) => { shared = k; };
