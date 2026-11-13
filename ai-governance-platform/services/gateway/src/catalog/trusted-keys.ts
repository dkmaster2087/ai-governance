/**
 * Probaline's catalog-signing public keys, compiled into the image. Only catalogs signed by one of these (or by a
 * key in CATALOG_TRUSTED_KEYS) are applied.
 *
 * Each is the public half of a KMS key in our account (infra: services stack, CatalogSigningKey, alias
 * `alias/<prefix>-catalog-signing-<stage>`). After a stage's first deploy creates its key, print the public half
 * with `node scripts/catalog-sign.mjs --kms <key id> --public-key` and add it here before that stage publishes;
 * keep old keys while catalogs they signed may still be the newest an install has.
 *
 * Unlike license keys, an install may add its own (CATALOG_TRUSTED_KEYS): a company that mirrors the catalog and
 * adds services of its own signs them with its key. A catalog only names AI services, so trusting more signers
 * can add services to watch, never remove a check.
 */
export const TRUSTED_CATALOG_KEYS: Array<{ label: string; publicKey: string }> = [];
