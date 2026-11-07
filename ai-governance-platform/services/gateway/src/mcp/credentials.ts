import { SecretBackend } from '../services/provider-key.store';
import { secretBackend } from '../services/secret-store';

/**
 * Credentials Probaline uses to call a company's API. Kept in the secret store, like provider keys; the
 * database holds only the reference and the last four characters.
 */
export class McpCredentialStore {
  private cache = new Map<string, { value: string; until: number }>();
  constructor(
    private backend: SecretBackend = secretBackend(),
    private prefix = `${process.env.PROVIDER_KEYS_SECRET_PREFIX || `probaline/${process.env.STAGE || 'dev'}/provider-keys`}/mcp`,
  ) {}

  async save(tenantId: string, apiId: string, secret: string): Promise<string> {
    const arn = await this.backend.put(`${this.prefix}/${tenantId}/${apiId}`, secret, { tenantId, apiId, kind: 'mcp-backend' });
    this.cache.set(arn, { value: secret, until: Date.now() + 5 * 60_000 });
    return arn;
  }

  async get(arn: string): Promise<string> {
    const c = this.cache.get(arn);
    if (c && c.until > Date.now()) return c.value;
    const value = await this.backend.get(arn);
    this.cache.set(arn, { value, until: Date.now() + 5 * 60_000 });
    return value;
  }

  async remove(arn: string | undefined): Promise<void> {
    if (!arn) return;
    this.cache.delete(arn);
    await this.backend.delete(arn).catch(() => undefined);
  }
}

export const hint = (secret: string) => `…${secret.slice(-4)}`;
