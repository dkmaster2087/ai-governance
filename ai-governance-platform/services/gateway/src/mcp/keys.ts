import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, JsonWebKey, KeyObject, randomBytes } from 'crypto';
import {
  CreateSecretCommand, GetSecretValueCommand, PutSecretValueCommand, ResourceExistsException, ResourceNotFoundException, SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { Alg, Claims, signJwt } from './jwt';
import { secretBackend, usesDatabaseSecrets } from '../services/secret-store';

const logger = createLogger('gateway:mcp-keys');

/**
 * The gateway's own keys for MCP: one signing key (ES256) for the access tokens it gives agents and the
 * identity statements it sends to company APIs, and one encryption key for refresh tokens it keeps from
 * identity providers. Both live in the secret store, created once by whichever gateway instance gets there
 * first; every instance then uses the same ones.
 */

export interface KeyVault {
  /** Read the secret with this name, or create it with `make()` if there is none. Never overwrites. */
  getOrCreate(name: string, make: () => string): Promise<string>;
  /** Replace the secret's value (key rotation). */
  put?(name: string, value: string): Promise<void>;
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

  async put(name: string, value: string): Promise<void> {
    await this.client.send(new PutSecretValueCommand({ SecretId: name, SecretString: value }));
  }
}

/** The gateway's MCP keys in the database, for installs without AWS (SECRET_STORE=database). */
export class DatabaseVault implements KeyVault {
  private db = () => secretBackend().database();
  async getOrCreate(name: string, make: () => string): Promise<string> {
    const existing = await this.db().read(name);
    if (existing !== null) return existing;
    const value = make();
    if (await this.db().create(name, value, { kind: 'mcp-gateway-keys' })) return value;
    return (await this.db().read(name))!; // another instance created it first
  }
  async put(name: string, value: string) { await this.db().put(name, value, { kind: 'mcp-gateway-keys' }); }
}

export class MemoryVault implements KeyVault {
  private values = new Map<string, string>();
  async getOrCreate(name: string, make: () => string) {
    if (!this.values.has(name)) this.values.set(name, make());
    return this.values.get(name)!;
  }
  async put(name: string, value: string) { this.values.set(name, value); }
}

/**
 * The signing keys rotate on their own (scheduleKeyRotation): every ROTATE_DAYS a next key is published
 * alongside the current one; OVERLAP_DAYS later it becomes the one that signs, and the old one stays published
 * for OVERLAP_DAYS more so anything it signed can still be checked. Company APIs that cache the JWKS for up to
 * OVERLAP_DAYS never see an unknown key. The refresh-token encryption key doesn't rotate (refresh tokens are
 * replaced on every use).
 */
export const ROTATE_DAYS = () => Number(process.env.MCP_KEY_ROTATE_DAYS) || 90;
export const OVERLAP_DAYS = () => Number(process.env.MCP_KEY_OVERLAP_DAYS) || 7;
const DAY = 86_400_000;

interface KeyEntry { kid: string; privateJwk: JsonWebKey; createdAt?: string; retiredAt?: string }
interface Bundle { current: KeyEntry; next?: KeyEntry; previous?: KeyEntry; encKey: string }

function newEntry(now = new Date()): KeyEntry {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const privateJwk = privateKey.export({ format: 'jwk' });
  const kid = createHash('sha256').update(JSON.stringify({ crv: privateJwk.crv, kty: privateJwk.kty, x: privateJwk.x, y: privateJwk.y })).digest('base64url').slice(0, 16);
  return { kid, privateJwk, createdAt: now.toISOString() };
}

function newBundle(): string {
  return JSON.stringify({ current: newEntry(), encKey: randomBytes(32).toString('base64') } satisfies Bundle);
}

/** Reads both the current format and the first one ({kid, privateJwk, encKey}, no dates). */
function parseBundle(raw: string): Bundle {
  const b = JSON.parse(raw);
  if (b.current) return b as Bundle;
  return { current: { kid: b.kid, privateJwk: b.privateJwk }, encKey: b.encKey };
}

/** What the next rotation step is, if any. Pure, for the scheduler and tests. */
export function rotationStep(b: Bundle, now: Date): { bundle: Bundle; did: string } | null {
  const age = (iso?: string) => (iso ? now.getTime() - Date.parse(iso) : Infinity);
  const overlap = OVERLAP_DAYS() * DAY;
  if (b.previous && age(b.previous.retiredAt) >= overlap) {
    const { previous: _p, ...rest } = b;
    return { bundle: rest, did: `stopped publishing old key ${b.previous.kid}` };
  }
  if (b.next && age(b.next.createdAt) >= overlap) {
    return {
      bundle: { current: b.next, previous: { ...b.current, retiredAt: now.toISOString() }, encKey: b.encKey },
      did: `now signing with ${b.next.kid}; ${b.current.kid} stays published for ${OVERLAP_DAYS()} days`,
    };
  }
  if (!b.next && !b.previous && age(b.current.createdAt) >= ROTATE_DAYS() * DAY - overlap) {
    const next = newEntry(now);
    return { bundle: { ...b, next }, did: `published next key ${next.kid}` };
  }
  return null;
}

interface Loaded { kid: string; privateKey: KeyObject; publics: Map<string, { key: KeyObject; jwk: JsonWebKey }>; encKey: Buffer; until: number }

export class GatewayKeys {
  private loaded?: Promise<Loaded>;

  constructor(
    private vault: KeyVault = usesDatabaseSecrets() ? new DatabaseVault() : new SecretsManagerVault(),
    private name = `${process.env.PROVIDER_KEYS_SECRET_PREFIX || `probaline/${process.env.STAGE || 'dev'}/provider-keys`}/mcp/gateway-keys`,
    /** Every instance re-reads the keys this often, so a rotation reaches all of them. */
    private reloadMs = 10 * 60_000,
  ) {}

  private load(): Promise<Loaded> {
    const fresh = this.loaded;
    if (fresh) {
      return fresh.then((l) => {
        if (l.until > Date.now()) return l;
        this.loaded = undefined;
        return this.load();
      });
    }
    this.loaded = this.vault.getOrCreate(this.name, newBundle).then((raw) => {
      const b = parseBundle(raw);
      const publics = new Map<string, { key: KeyObject; jwk: JsonWebKey }>();
      for (const e of [b.current, b.next, b.previous]) {
        if (!e) continue;
        const key = createPublicKey(createPrivateKey({ key: e.privateJwk, format: 'jwk' }));
        const { kty, crv, x, y } = key.export({ format: 'jwk' });
        publics.set(e.kid, { key, jwk: { kty, crv, x, y, kid: e.kid, use: 'sig', alg: 'ES256' } });
      }
      return {
        kid: b.current.kid, privateKey: createPrivateKey({ key: b.current.privateJwk, format: 'jwk' }), publics,
        encKey: Buffer.from(b.encKey, 'base64'), until: Date.now() + this.reloadMs,
      };
    }).catch((err) => { this.loaded = undefined; throw err; });
    return this.loaded;
  }

  async sign(claims: Claims, typ: string): Promise<string> {
    const k = await this.load();
    return signJwt({ alg: 'ES256' as Alg, kid: k.kid, typ }, claims, k.privateKey);
  }

  /** The public key for a kid: the current one, the next one, or the one just retired. */
  async publicKey(kid?: string): Promise<KeyObject | null> {
    const k = await this.load();
    return (kid && k.publics.get(kid)?.key) || null;
  }

  /** Published at /.well-known/jwks.json so company APIs can check what Probaline signs. */
  async jwks() {
    return { keys: [...(await this.load()).publics.values()].map((p) => p.jwk) };
  }

  /** One rotation step if one is due. Run by one instance a day (scheduleKeyRotation). */
  async rotate(now = new Date()): Promise<string | null> {
    if (!this.vault.put) return null;
    const step = rotationStep(parseBundle(await this.vault.getOrCreate(this.name, newBundle)), now);
    if (!step) return null;
    await this.vault.put(this.name, JSON.stringify(step.bundle));
    this.loaded = undefined;
    return step.did;
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

/** Check hourly; one instance a day takes a rotation step when one is due. */
export function scheduleKeyRotation(): NodeJS.Timeout {
  const run = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const claimed = await collection('metrics').put({ tenantId: 'platform', period: `mcp-key-rotation#${today}`, ttl: Math.floor(Date.now() / 1000) + 3 * 86_400 }, { ifNotExists: true });
    if (!claimed) return;
    const did = await gatewayKeys().rotate();
    if (did) logger.info('MCP signing key rotation', { step: did });
  };
  const tick = () => { run().catch((err) => logger.error('MCP key rotation failed', { error: (err as Error).message })); };
  setTimeout(tick, 90_000).unref();
  const timer = setInterval(tick, 3600_000);
  timer.unref();
  return timer;
}
