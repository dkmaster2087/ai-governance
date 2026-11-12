import Fastify from 'fastify';
import { generateKeyPairSync } from 'crypto';
import { collection, MemoryStore, setRecords } from '@ai-governance/storage';
import { LocalLicenseSigner, signLicenseFile, trustLicenseKeysForTests, verifyLicenseFile } from '../licensing/license-file';
import { licensedAddressOnly, OfflineLicenseState, setOfflineLicense } from '../licensing/offline-license';
import { licenseState } from '../services/license-state';

const DAY = 86_400_000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { priv: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string, pub: publicKey.export({ format: 'pem', type: 'spki' }) as string };
};
const OURS = pair();
const signer = new LocalLicenseSigner(OURS.priv);
const claims = (over: object = {}) => ({
  id: 'lic_1', customer: 'Acme', tenantId: 'tenant_acme', plan: 'enterprise' as const,
  addresses: ['AI-Gateway.Acme.com'], issuedAt: iso(-1), endsAt: iso(365), ...over,
});
const fileFor = (over: object = {}, s = signer) => signLicenseFile(claims(over), s);

beforeAll(() => trustLicenseKeysForTests([{ publicKey: OURS.pub, label: 'test' }]));
afterAll(() => trustLicenseKeysForTests(null));

describe('license files', () => {
  it('verifies what we signed, with the address normalised', async () => {
    const c = verifyLicenseFile(await fileFor());
    expect(c).toMatchObject({ id: 'lic_1', plan: 'enterprise', addresses: ['ai-gateway.acme.com'] });
  });

  it('still verifies an older file that names a number of users (no longer used)', async () => {
    expect(verifyLicenseFile(await fileFor({ maxUsers: 50 }))).toMatchObject({ id: 'lic_1', plan: 'enterprise' });
  });

  it('refuses a changed file, one signed by someone else, and anything malformed', async () => {
    const file = await fileFor();
    const [p, payload, sig] = file.split('.');
    const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), endsAt: iso(3650) })).toString('base64url');
    expect(() => verifyLicenseFile(`${p}.${edited}.${sig}`)).toThrow(expect.objectContaining({ code: 'BAD_SIGNATURE' }));
    // A customer signing their own license with their own key: our compiled-in keys don't know it.
    expect(() => verifyLicenseFile(file.replace(/\.[^.]+$/, '.AAAA'))).toThrow(expect.objectContaining({ code: 'BAD_SIGNATURE' }));
    const theirs = await fileFor({}, new LocalLicenseSigner(pair().priv));
    expect(() => verifyLicenseFile(theirs)).toThrow(expect.objectContaining({ code: 'UNKNOWN_KEY' }));
    expect(() => verifyLicenseFile('pbl_acme_123')).toThrow(expect.objectContaining({ code: 'MALFORMED' }));
  });
});

describe('a customer-run install (LICENSING=offline)', () => {
  let state: OfflineLicenseState;
  beforeEach(() => {
    setRecords(new MemoryStore());
    state = new OfflineLicenseState(0);
    setOfflineLicense(state);
    process.env.LICENSING = 'offline';
    delete process.env.PROBALINE_LICENSE;
  });
  afterAll(() => { delete process.env.LICENSING; setOfflineLicense(null); });

  it('starts with 30 days of grace, and is active once a license is entered', async () => {
    expect(await licenseState().get('tenant_acme')).toMatchObject({ state: 'grace', reason: 'none', daysLeft: 30 });
    await state.install(await fileFor(), 'u1');
    expect(await licenseState().get('any-company')).toMatchObject({ state: 'active', plan: 'enterprise' });
  });

  it('follows Cloud’s timeline: notices in the last 30 days, 30 days of grace, then lapsed', async () => {
    await collection('metrics').put({ tenantId: '_install', period: 'license#current', licenseFile: await fileFor({ endsAt: iso(12) }) });
    expect(await state.get()).toMatchObject({ state: 'expiring', daysLeft: 12 });
    await collection('metrics').put({ tenantId: '_install', period: 'license#current', licenseFile: await fileFor({ endsAt: iso(-5) }) });
    state.invalidate();
    expect(await state.get()).toMatchObject({ state: 'grace', reason: 'expired', daysLeft: 25 });
    await collection('metrics').put({ tenantId: '_install', period: 'license#current', licenseFile: await fileFor({ endsAt: iso(-31) }) });
    state.invalidate();
    expect(await state.get()).toMatchObject({ state: 'lapsed', reason: 'expired' });
  });

  it('refuses an ended or foreign license, and takes one from PROBALINE_LICENSE at install time', async () => {
    await expect(state.install(await fileFor({ endsAt: iso(-1) }), 'u1')).rejects.toThrow(/already ended/);
    await expect(state.install(await fileFor({}, new LocalLicenseSigner(pair().priv)), 'u1')).rejects.toThrow(/wasn’t issued by Probaline/);
    process.env.PROBALINE_LICENSE = await fileFor({ id: 'lic_env' });
    expect((await state.current())?.claims.id).toBe('lic_env');
    expect((await state.current())?.source).toBe('environment');
  });

  it('serves only the licensed address; health and the License page answer on any', async () => {
    const app = Fastify();
    licensedAddressOnly(app, () => state);
    app.get('/v1/chat/completions', async () => ({ ok: true }));
    app.get('/health', async () => ({ ok: true }));
    app.get('/v1/license/overview', async () => ({ ok: true }));
    const at = (host: string, url = '/v1/chat/completions') => app.inject({ method: 'GET', url, headers: { host } }).then((r) => r.statusCode);
    // Before a license is entered, any address works.
    expect(await at('10.0.0.5:3000')).toBe(200);
    await state.install(await fileFor(), 'u1');
    expect(await at('ai-gateway.acme.com')).toBe(200);
    expect(await at('AI-GATEWAY.ACME.COM:443')).toBe(200);
    expect(await at('ai-gateway.eu.acme.com')).toBe(421);
    expect(await at('10.0.0.5:3000', '/health')).toBe(200);
    expect(await at('10.0.0.5:3000', '/v1/license/overview')).toBe(200);
  });
});
