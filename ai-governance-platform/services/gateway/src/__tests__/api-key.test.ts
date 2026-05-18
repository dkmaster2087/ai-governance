import { generateApiKey, hashApiKey } from '../repositories/api-key.repository';

describe('API Key Management', () => {
  describe('generateApiKey', () => {
    it('generates a key with correct format', () => {
      const result = generateApiKey('tenant_demo');
      expect(result.raw).toMatch(/^aegis_demo_[a-f0-9]{48}$/);
      expect(result.prefix).toMatch(/^aegis_demo_[a-f0-9].*\.\.\.$/);
      expect(result.keyId).toMatch(/^key_[a-f0-9]{16}$/);
      expect(result.hash).toHaveLength(64); // SHA-256 hex
    });

    it('generates unique keys each time', () => {
      const key1 = generateApiKey('tenant_demo');
      const key2 = generateApiKey('tenant_demo');
      expect(key1.raw).not.toBe(key2.raw);
      expect(key1.hash).not.toBe(key2.hash);
      expect(key1.keyId).not.toBe(key2.keyId);
    });

    it('uses tenant prefix in key', () => {
      const result = generateApiKey('tenant_healthco');
      expect(result.raw.startsWith('aegis_health')).toBe(true);
    });

    it('truncates long tenant names', () => {
      const result = generateApiKey('tenant_verylongtenant');
      expect(result.raw.startsWith('aegis_verylo')).toBe(true);
    });
  });

  describe('hashApiKey', () => {
    it('produces consistent hash for same input', () => {
      const hash1 = hashApiKey('aegis_demo_abc123');
      const hash2 = hashApiKey('aegis_demo_abc123');
      expect(hash1).toBe(hash2);
    });

    it('produces different hash for different input', () => {
      const hash1 = hashApiKey('aegis_demo_abc123');
      const hash2 = hashApiKey('aegis_demo_xyz789');
      expect(hash1).not.toBe(hash2);
    });

    it('returns 64-char hex string (SHA-256)', () => {
      const hash = hashApiKey('test-key');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('key validation logic', () => {
    it('generated key hash matches hashApiKey of raw key', () => {
      const { raw, hash } = generateApiKey('tenant_test');
      expect(hashApiKey(raw)).toBe(hash);
    });
  });
});
