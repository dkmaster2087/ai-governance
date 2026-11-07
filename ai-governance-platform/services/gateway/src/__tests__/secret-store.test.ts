import { randomBytes } from 'crypto';
import { collection, MemoryStore, setRecords } from '@ai-governance/storage';
import { DatabaseSecretBackend, DB_REF, RoutingSecretBackend, SecretKeyError, setSecretBackend } from '../services/secret-store';
import { GatewayKeys, DatabaseVault } from '../mcp/keys';

const KEY = randomBytes(32).toString('base64');
const OTHER = randomBytes(32).toString('base64');

describe('secrets in the database (installs without AWS)', () => {
  beforeEach(() => setRecords(new MemoryStore()));
  afterEach(() => setSecretBackend(null));

  it('stores secrets encrypted, never in the clear, and reads them back', async () => {
    const db = new DatabaseSecretBackend({ SECRETS_ENCRYPTION_KEY: KEY });
    const ref = await db.put('probaline/prod/provider-keys/t1/m1', 'sk-live-secret', { tenantId: 't1' });
    expect(ref).toBe(`${DB_REF}probaline/prod/provider-keys/t1/m1`);
    const row = await collection('secrets').get({ scope: 'secrets', name: 'probaline/prod/provider-keys/t1/m1' });
    expect(JSON.stringify(row)).not.toContain('sk-live-secret');
    expect(await db.get(ref)).toBe('sk-live-secret');
    await db.delete(ref);
    await expect(db.get(ref)).rejects.toThrow('Secret not found');
  });

  it('refuses a value moved to another secret\'s name, and a missing or wrong-size key', async () => {
    const db = new DatabaseSecretBackend({ SECRETS_ENCRYPTION_KEY: KEY });
    await db.put('a', 'value-a', {});
    const row = await collection('secrets').get({ scope: 'secrets', name: 'a' }) as Record<string, unknown>;
    await collection('secrets').put({ ...row, name: 'b' });
    await expect(db.get(`${DB_REF}b`)).rejects.toThrow();
    expect(() => new DatabaseSecretBackend({})).toThrow(SecretKeyError);
    expect(() => new DatabaseSecretBackend({ SECRETS_ENCRYPTION_KEY: Buffer.from('short').toString('base64') })).toThrow(/32 bytes/);
  });

  it('changes key: old secrets read with the old key, new saves use the new one', async () => {
    const before = new DatabaseSecretBackend({ SECRETS_ENCRYPTION_KEY: KEY });
    const ref = await before.put('s', 'kept', {});
    expect(() => new DatabaseSecretBackend({ SECRETS_ENCRYPTION_KEY: OTHER })).not.toThrow();
    await expect(new DatabaseSecretBackend({ SECRETS_ENCRYPTION_KEY: OTHER }).get(ref)).rejects.toThrow(/key this gateway doesn't have/);
    const after = new DatabaseSecretBackend({ SECRETS_ENCRYPTION_KEY: OTHER, SECRETS_ENCRYPTION_KEY_OLD: KEY });
    expect(await after.get(ref)).toBe('kept');
    await after.put('s', 'kept', {});
    expect(await new DatabaseSecretBackend({ SECRETS_ENCRYPTION_KEY: OTHER }).get(ref)).toBe('kept');
  });

  it('saves where SECRET_STORE says, and still reads references saved in AWS', async () => {
    const routed = new RoutingSecretBackend('database', { SECRETS_ENCRYPTION_KEY: KEY });
    const ref = await routed.put('x', 'v', {});
    expect(ref.startsWith(DB_REF)).toBe(true);
    expect(await routed.get(ref)).toBe('v');
    // An ARN goes to Secrets Manager (not reachable here, so it fails rather than reading the database).
    await expect(routed.get('arn:aws:secretsmanager:us-east-1:1:secret:x')).rejects.toThrow();
  });

  it('keeps the gateway\'s MCP keys there too, shared by every instance', async () => {
    setSecretBackend(new RoutingSecretBackend('database', { SECRETS_ENCRYPTION_KEY: KEY }));
    const a = new GatewayKeys(new DatabaseVault(), 'mcp/gateway-keys', 0);
    const b = new GatewayKeys(new DatabaseVault(), 'mcp/gateway-keys', 0);
    const token = await a.sign({ sub: 'x' }, 'test');
    const kid = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).kid;
    expect(await b.publicKey(kid)).not.toBeNull();
    expect(await a.rotate(new Date(Date.now() + 83 * 86_400_000))).toMatch(/published next key/);
    expect((await b.jwks()).keys).toHaveLength(2);
  });
});
