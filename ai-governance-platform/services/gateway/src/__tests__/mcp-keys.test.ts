import { createVerify } from 'crypto';
import { GatewayKeys, MemoryVault } from '../mcp/keys';

const DAY = 86_400_000;
const NAME = 'probaline/test/mcp/gateway-keys';

/** Checks an ES256 token against a JWKS the way a company API would. */
async function verifiedBy(keys: GatewayKeys, token: string): Promise<boolean> {
  const [h, p, sig] = token.split('.');
  const { kid } = JSON.parse(Buffer.from(h, 'base64url').toString());
  const pub = await keys.publicKey(kid);
  if (!pub) return false;
  return createVerify('SHA256').update(`${h}.${p}`).verify({ key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
}
const kidOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).kid as string;
const kids = async (k: GatewayKeys) => (await k.jwks()).keys.map((j) => j.kid);

describe('MCP signing keys', () => {
  it('rotate on their own: publish the next key, switch after the overlap, then drop the old one', async () => {
    const vault = new MemoryVault();
    const keys = new GatewayKeys(vault, NAME, 0);
    const first = await keys.sign({ sub: 'a' }, 'test');
    // Days count from after the first key exists: rotation is due a set time after the key was made.
    const start = Date.now();
    const at = (days: number) => new Date(start + days * DAY);

    const k1 = kidOf(first);
    expect(await kids(keys)).toEqual([k1]);
    expect(await keys.rotate(at(10))).toBeNull(); // nothing due yet

    // Day 83: the next key is published, but signing stays with the current one.
    expect(await keys.rotate(at(83))).toMatch(/published next key/);
    const [, k2] = await kids(keys);
    expect(await kids(keys)).toEqual([k1, k2]);
    expect(kidOf(await keys.sign({ sub: 'b' }, 'test'))).toBe(k1);

    // Day 90: the next key signs; the old one is still published, so what it signed still checks out.
    expect(await keys.rotate(at(90))).toMatch(/now signing with/);
    const after = await keys.sign({ sub: 'c' }, 'test');
    expect(kidOf(after)).toBe(k2);
    expect(await verifiedBy(keys, first)).toBe(true);
    expect(await verifiedBy(keys, after)).toBe(true);
    expect((await kids(keys)).sort()).toEqual([k1, k2].sort());

    // Day 97: the old key is gone.
    expect(await keys.rotate(at(97))).toMatch(/stopped publishing/);
    expect(await kids(keys)).toEqual([k2]);
    expect(await verifiedBy(keys, first)).toBe(false);
    // And the cycle continues from the new key's date.
    expect(await keys.rotate(at(120))).toBeNull();
    expect(await keys.rotate(at(90 + 83))).toMatch(/published next key/);
  });

  it('reads keys made before rotation existed, and starts rotating them', async () => {
    const vault = new MemoryVault();
    const old = new GatewayKeys(vault, NAME, 0);
    // The first format: one key, no dates.
    const { generateKeyPairSync, randomBytes } = await import('crypto');
    const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
    await vault.put(NAME, JSON.stringify({ kid: 'legacykid', privateJwk: jwk, encKey: randomBytes(32).toString('base64') }));
    const sealed = await old.encrypt('refresh-token');
    expect(kidOf(await old.sign({ sub: 'x' }, 'test'))).toBe('legacykid');
    expect(await old.rotate()).toMatch(/published next key/);
    expect(await old.decrypt(sealed)).toBe('refresh-token'); // the encryption key is kept
  });

  it('every instance picks up a rotation another instance made', async () => {
    const vault = new MemoryVault();
    const a = new GatewayKeys(vault, NAME, 0);
    const b = new GatewayKeys(vault, NAME, 0);
    const k1 = kidOf(await b.sign({}, 'test'));
    await a.rotate(new Date(Date.now() + 83 * DAY));
    await a.rotate(new Date(Date.now() + 90 * DAY));
    expect(kidOf(await b.sign({}, 'test'))).not.toBe(k1);
  });
});
