import { newInternalKey, signingKeyFrom, signingKeyFromEnv, signInternal, trustedKeysFrom, trustedKeysFromEnv, verifyInternal } from '../internal-auth';

const gw = newInternalKey('gateway');
const agent = newInternalKey('reporting-agent');
const SIGN = signingKeyFrom(gw.signing);
const TRUST = trustedKeysFrom([gw.trusted, agent.trusted]);
const caller = { tenantId: 'tenant_a', userId: 'u1', role: 'tenant_admin', email: 'a@acme.example' };

describe('internal service tokens', () => {
  it('carries the company, user and role to the internal service', () => {
    expect(verifyInternal(signInternal(caller, SIGN, 'analytics'), TRUST, 'analytics')).toEqual(caller);
  });

  it('refuses an untrusted key, another service, tampering, expiry and malformed tokens', () => {
    const t = signInternal(caller, SIGN, 'analytics');
    expect(() => verifyInternal(t, trustedKeysFrom([newInternalKey('gateway').trusted]), 'analytics')).toThrow(/Unknown signing key/);
    expect(() => verifyInternal(t, TRUST, 'policy-engine')).toThrow(/not for this service/);
    const [h, , s] = t.split('.');
    const other = Buffer.from(JSON.stringify({ iss: 'gateway', aud: 'analytics', tid: 'tenant_b', sub: 'u1', role: 'tenant_admin', iat: 1, exp: 9e9 })).toString('base64url');
    expect(() => verifyInternal(`${h}.${other}.${s}`, TRUST, 'analytics')).toThrow(/signature/);
    const old = signInternal(caller, SIGN, 'analytics', Math.floor(Date.now() / 1000) - 600);
    expect(() => verifyInternal(old, TRUST, 'analytics')).toThrow(/expired/);
    expect(() => verifyInternal('nope', TRUST, 'analytics')).toThrow(/Malformed/);
  });

  it('lets a reporting agent\'s key act only as the reporting agent', () => {
    const a = signingKeyFrom(agent.signing);
    expect(() => signInternal(caller, a, 'analytics')).toThrow(/reporting-agent/);
    expect(verifyInternal(signInternal({ tenantId: 't', userId: 'reporting-agent', role: 'reporting_agent' }, a, 'analytics'), TRUST, 'analytics').role).toBe('reporting_agent');
    // A token claiming the gateway but signed by the agent's key is refused, whatever it says.
    const [h, , ] = signInternal({ tenantId: 't', userId: 'x', role: 'reporting_agent' }, a, 'analytics').split('.');
    const forged = Buffer.from(JSON.stringify({ iss: 'gateway', aud: 'analytics', tid: 't', sub: 'x', role: 'platform_admin', iat: Math.floor(Date.now() / 1000), exp: 9e9 })).toString('base64url');
    const { sign } = require('crypto');
    const sig = sign('sha256', Buffer.from(`${h}.${forged}`), { key: a.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    expect(() => verifyInternal(`${h}.${forged}.${sig}`, TRUST, 'analytics')).toThrow(/issuer/);
  });

  it('trusts two keys at once while one is rotated', () => {
    const next = newInternalKey('gateway');
    const both = trustedKeysFrom([gw.trusted, next.trusted]);
    expect(verifyInternal(signInternal(caller, SIGN, 'analytics'), both, 'analytics')).toEqual(caller);
    expect(verifyInternal(signInternal(caller, signingKeyFrom(next.signing), 'analytics'), both, 'analytics')).toEqual(caller);
  });

  it('reads keys from the environment and refuses missing or wrong ones', () => {
    expect(signingKeyFromEnv({ INTERNAL_SIGNING_KEY: JSON.stringify(gw.signing) }).iss).toBe('gateway');
    expect(trustedKeysFromEnv({ INTERNAL_TRUSTED_KEYS: JSON.stringify([gw.trusted]) })).toHaveLength(1);
    expect(() => signingKeyFromEnv({})).toThrow(/not set/);
    expect(() => trustedKeysFromEnv({ INTERNAL_TRUSTED_KEYS: '[]' })).toThrow(/No trusted keys/);
    const { generateKeyPairSync } = require('crypto');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' });
    expect(() => signingKeyFrom({ iss: 'gateway', privateKey: rsa })).toThrow(/P-256/);
  });
});
