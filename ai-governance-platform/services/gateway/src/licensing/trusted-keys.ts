/**
 * Probaline's license-signing public keys, compiled into the image. Only licenses signed by one of these are
 * accepted. Never read from configuration: an install that could add a key could sign its own licenses.
 *
 * Each is the public half of a KMS key in our account (infra: services stack, LicenseSigningKey). Add a key here
 * before it signs anything; keep old ones while licenses they signed are still in use.
 */
export const TRUSTED_LICENSE_KEYS: Array<{ label: string; publicKey: string }> = [
  {
    // alias/ai-gov-license-signing-dev (account 804516735505, us-east-1). Signs licenses issued from the dev stage.
    label: 'dev 2026-11-12',
    publicKey: `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEvHCkWkL02ma9LN5WpjKbZAzW/UN2
Zcn1AVL3qqMiNnxqL6UYg0FUPWPwyxLLm/Da3V9mgdRh4F95Y+vcWktB/g==
-----END PUBLIC KEY-----`,
  },
];
