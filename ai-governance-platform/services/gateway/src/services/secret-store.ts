import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { collection } from '@ai-governance/storage';
import { SecretBackend, SecretsManagerBackend } from './provider-key.store';

/**
 * Where the gateway keeps secrets: provider keys, MCP API credentials, log-export tokens and its own MCP keys.
 *
 *   SECRET_STORE=aws (default)  AWS Secrets Manager, under the platform's KMS key.
 *   SECRET_STORE=database       In the database, encrypted by the gateway with AES-256-GCM under
 *                               SECRETS_ENCRYPTION_KEY (32 bytes, base64). For installs without AWS (PostgreSQL).
 *                               To change the key, set the new one and keep the old as SECRETS_ENCRYPTION_KEY_OLD;
 *                               secrets are re-encrypted with the new key as they're next saved.
 *
 * A secret's reference says where it lives (`db-secret:<name>` or a Secrets Manager ARN), so references
 * saved before a switch keep working.
 */
export const DB_REF = 'db-secret:';

export class SecretKeyError extends Error {}

interface Sealed { scope: 'secrets'; name: string; kid: string; iv: string; tag: string; data: string; tags: Record<string, string>; updatedAt: string }

const keyId = (key: Buffer) => createHash('sha256').update(key).digest('hex').slice(0, 12);

function readKey(raw: string | undefined, name: string): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new SecretKeyError(`${name} must be 32 bytes, base64-encoded (e.g. openssl rand -base64 32)`);
  return key;
}

export class DatabaseSecretBackend implements SecretBackend {
  private keys: Map<string, Buffer>;
  private current: { kid: string; key: Buffer };

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const key = readKey(env.SECRETS_ENCRYPTION_KEY, 'SECRETS_ENCRYPTION_KEY');
    if (!key) throw new SecretKeyError('SECRET_STORE=database needs SECRETS_ENCRYPTION_KEY (32 bytes, base64)');
    const old = readKey(env.SECRETS_ENCRYPTION_KEY_OLD, 'SECRETS_ENCRYPTION_KEY_OLD');
    this.current = { kid: keyId(key), key };
    this.keys = new Map([[keyId(key), key], ...(old ? [[keyId(old), old] as [string, Buffer]] : [])]);
  }

  private table = () => collection<Sealed>('secrets');

  async put(name: string, value: string, tags: Record<string, string>): Promise<string> {
    await this.table().put(this.seal(name, value, tags));
    return `${DB_REF}${name}`;
  }

  /** Store only if there's no value yet; false if another instance got there first. */
  async create(name: string, value: string, tags: Record<string, string>): Promise<boolean> {
    return this.table().put(this.seal(name, value, tags), { ifNotExists: true });
  }

  private seal(name: string, value: string, tags: Record<string, string>): Sealed {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.current.key, iv);
    c.setAAD(Buffer.from(name)); // a value can't be moved to another secret's name
    const data = Buffer.concat([c.update(value, 'utf8'), c.final()]);
    return {
      scope: 'secrets', name, kid: this.current.kid, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'),
      data: data.toString('base64'), tags, updatedAt: new Date().toISOString(),
    };
  }

  /** Read a value; also used by the MCP key vault. */
  async read(name: string): Promise<string | null> {
    const row = await this.table().get({ scope: 'secrets', name });
    if (!row) return null;
    const key = this.keys.get(row.kid);
    if (!key) throw new SecretKeyError(`Secret ${name} was encrypted with a key this gateway doesn't have (${row.kid})`);
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'));
    d.setAAD(Buffer.from(name));
    d.setAuthTag(Buffer.from(row.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(row.data, 'base64')), d.final()]).toString('utf8');
  }

  async get(ref: string): Promise<string> {
    const value = await this.read(ref.startsWith(DB_REF) ? ref.slice(DB_REF.length) : ref);
    if (value === null) throw new Error('Secret not found');
    return value;
  }

  async delete(ref: string): Promise<void> {
    await this.table().delete({ scope: 'secrets', name: ref.startsWith(DB_REF) ? ref.slice(DB_REF.length) : ref });
  }
}

/** Saves where SECRET_STORE says; reads and deletes wherever each reference points. */
export class RoutingSecretBackend implements SecretBackend {
  private db?: DatabaseSecretBackend;
  private aws?: SecretBackend;
  constructor(private mode = process.env.SECRET_STORE === 'database' ? 'database' : 'aws', private env: NodeJS.ProcessEnv = process.env) {}

  database() { return (this.db ??= new DatabaseSecretBackend(this.env)); }
  private awsBackend() { return (this.aws ??= new SecretsManagerBackend()); }
  private forRef(ref: string): SecretBackend { return ref.startsWith(DB_REF) ? this.database() : this.awsBackend(); }

  put(name: string, value: string, tags: Record<string, string>) {
    return (this.mode === 'database' ? this.database() : this.awsBackend()).put(name, value, tags);
  }
  get(ref: string) { return this.forRef(ref).get(ref); }
  delete(ref: string) { return this.forRef(ref).delete(ref); }
}

let shared: RoutingSecretBackend | null = null;
export const secretBackend = () => (shared ??= new RoutingSecretBackend());
export const setSecretBackend = (b: RoutingSecretBackend | null) => { shared = b; };
export const usesDatabaseSecrets = () => process.env.SECRET_STORE === 'database';
