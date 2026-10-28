import { hashContent, maskPII, generateRequestId, generateTenantId } from '../crypto';

describe('hashContent', () => {
  it('returns a 64-char hex string', () => {
    expect(hashContent('hello')).toHaveLength(64);
  });

  it('is deterministic', () => {
    expect(hashContent('test')).toBe(hashContent('test'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});

describe('maskPII', () => {
  it('masks email addresses', () => {
    expect(maskPII('contact user@example.com please')).toBe('contact [REDACTED] please');
  });

  it('masks phone numbers', () => {
    expect(maskPII('call 416-555-1234 now')).toBe('call [REDACTED] now');
  });

  it('masks SSNs', () => {
    expect(maskPII('ssn is 123-45-6789')).toBe('ssn is [REDACTED]');
  });

  it('masks credit cards', () => {
    expect(maskPII('card 4111 1111 1111 1111 ok')).toBe('card [REDACTED] ok');
  });

  it('returns unchanged text when no PII present', () => {
    expect(maskPII('hello world')).toBe('hello world');
  });

  it('supports custom placeholder', () => {
    expect(maskPII('email user@test.com here', '***')).toBe('email *** here');
  });
});

describe('generateRequestId', () => {
  it('returns a UUID string', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generates unique IDs', () => {
    expect(generateRequestId()).not.toBe(generateRequestId());
  });
});

describe('generateTenantId', () => {
  it('starts with tenant_', () => {
    expect(generateTenantId()).toMatch(/^tenant_/);
  });
});

describe('maskPII card numbers', () => {
  const { maskPII } = require('../crypto');
  it.each([
    '4111111111111111',
    '4111 1111 1111 1111',
    '4111-1111-1111-1111',
    '378282246310005', // 15-digit Amex
  ])('fully masks %s', (card) => {
    const out = maskPII(`card ${card} ok`, '[X]');
    expect(out).toBe('card [X] ok');
  });

  it('leaves long non-card numbers alone', () => {
    expect(maskPII('ts 1700000000001 done', '[X]')).toBe('ts 1700000000001 done');
  });

  it('still masks phone numbers and SSNs', () => {
    expect(maskPII('call (555) 123-4567, ssn 123-45-6789', '[X]')).toBe('call [X], ssn [X]');
  });
});
