import { INTERNAL_HEADER, signInternal } from '@ai-governance/utils';
import { buildApp } from '../app';

const KEY = 'd'.repeat(40);
const as = (tenantId: string, role = 'gateway', audience = 'data-protection') =>
  ({ [INTERNAL_HEADER]: signInternal({ tenantId, userId: 'u', role }, KEY, audience) });
const prompt = (tenantId: string) => ({ requestId: 'r1', tenantId, userId: 'u', modelId: 'm', messages: [{ role: 'user', content: 'hello' }] });

describe('data protection answers only the gateway', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => { app = await buildApp({ key: () => KEY }); });
  afterAll(() => app.close());
  const post = (headers: Record<string, string>, tenantId = 'tenant_a') =>
    app.inject({ method: 'POST', url: '/v1/protect/request', headers, payload: prompt(tenantId) });

  it('answers a signed request for the same company', async () => {
    expect((await post(as('tenant_a'))).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('refuses unsigned, wrongly signed, other-service and other-company requests', async () => {
    expect((await post({})).statusCode).toBe(401);
    expect((await post({ [INTERNAL_HEADER]: signInternal({ tenantId: 'tenant_a', userId: 'u', role: 'gateway' }, 'z'.repeat(40), 'data-protection') })).statusCode).toBe(401);
    expect((await post(as('tenant_a', 'gateway', 'analytics'))).statusCode).toBe(401);
    expect((await post(as('tenant_a', 'reporting_agent'))).statusCode).toBe(403);
    expect((await post(as('tenant_b'))).statusCode).toBe(403);
  });
});
