import { describe, it, expect, vi } from 'vitest';
import { createApiClient, setAuthHeaderProvider, UNAUTHORIZED_EVENT } from '../lib/http';

function captureAdapter(status = 200) {
  const seen: Record<string, unknown>[] = [];
  const adapter = async (config: any) => {
    seen.push(config.headers.toJSON());
    if (status >= 400) {
      const err: any = new Error('fail');
      err.response = { status, data: {}, headers: {}, config };
      throw err;
    }
    return { data: {}, status, statusText: 'OK', headers: {}, config };
  };
  return { seen, adapter };
}

describe('createApiClient', () => {
  it('attaches the signed-in user credentials to every request', async () => {
    setAuthHeaderProvider(async () => ({ authorization: 'Bearer token-1', 'x-tenant-id': 'tenant_home' }));
    const { seen, adapter } = captureAdapter();
    const client = createApiClient('/api');
    client.defaults.adapter = adapter;
    await client.get('/v1/models', { headers: { authorization: 'Bearer test-key' } });
    expect(seen[0].authorization).toBe('Bearer token-1');
    expect(seen[0]['x-tenant-id']).toBe('tenant_home');
  });

  it('keeps an explicit target tenant (platform admins acting on another tenant)', async () => {
    setAuthHeaderProvider(async () => ({ authorization: 'Bearer t', 'x-tenant-id': 'tenant_platform' }));
    const { seen, adapter } = captureAdapter();
    const client = createApiClient('/api');
    client.defaults.adapter = adapter;
    await client.get('/v1/cost/summary/tenant_acme', { headers: { 'x-tenant-id': 'tenant_acme' } });
    expect(seen[0]['x-tenant-id']).toBe('tenant_acme');
  });

  it('signals sign-out when the backend rejects the credentials', async () => {
    setAuthHeaderProvider(async () => ({}));
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    const { adapter } = captureAdapter(401);
    const client = createApiClient('/api');
    client.defaults.adapter = adapter;
    await expect(client.get('/x')).rejects.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });
});
