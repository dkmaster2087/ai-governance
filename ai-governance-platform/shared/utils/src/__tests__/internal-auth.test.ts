import { internalKeyFromEnv, signInternal, verifyInternal } from '../internal-auth';

const KEY = 'k'.repeat(40);
const caller = { tenantId: 'tenant_a', userId: 'u1', role: 'tenant_admin', email: 'a@acme.example' };

describe('internal service tokens', () => {
  it('carries the company, user and role to the internal service', () => {
    expect(verifyInternal(signInternal(caller, KEY, 'analytics'), KEY, 'analytics')).toEqual(caller);
  });

  it('refuses another key, another service, tampering, expiry and malformed tokens', () => {
    const t = signInternal(caller, KEY, 'analytics');
    expect(() => verifyInternal(t, 'x'.repeat(40), 'analytics')).toThrow(/signature/);
    expect(() => verifyInternal(t, KEY, 'policy-engine')).toThrow(/not for this service/);
    const [h, , s] = t.split('.');
    const other = Buffer.from(JSON.stringify({ iss: 'gateway', aud: 'analytics', tid: 'tenant_b', sub: 'u1', role: 'tenant_admin', iat: 1, exp: 9e9 })).toString('base64url');
    expect(() => verifyInternal(`${h}.${other}.${s}`, KEY, 'analytics')).toThrow(/signature/);
    const old = signInternal(caller, KEY, 'analytics', Math.floor(Date.now() / 1000) - 600);
    expect(() => verifyInternal(old, KEY, 'analytics')).toThrow(/expired/);
    expect(() => verifyInternal('nope', KEY, 'analytics')).toThrow(/Malformed/);
  });

  it('needs a long key', () => {
    expect(() => internalKeyFromEnv({ INTERNAL_SERVICE_KEY: 'short' })).toThrow(/32/);
    expect(internalKeyFromEnv({ INTERNAL_SERVICE_KEY: KEY })).toBe(KEY);
  });
});
