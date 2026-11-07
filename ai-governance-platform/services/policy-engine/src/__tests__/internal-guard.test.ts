import { collection, MemoryStore, setRecords } from '@ai-governance/storage';
import { INTERNAL_HEADER, signInternal } from '@ai-governance/utils';
import { buildApp } from '../app';

const KEY = 'p'.repeat(40);
const as = (tenantId: string, role = 'gateway') =>
  ({ [INTERNAL_HEADER]: signInternal({ tenantId, userId: 'u', role }, KEY, 'policy-engine') });

describe('the policy engine answers only signed requests, about the company signed for', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => { setRecords(new MemoryStore()); app = await buildApp({ key: () => KEY }); });
  afterAll(() => app.close());
  const req = (method: 'GET' | 'POST' | 'DELETE', url: string, headers: Record<string, string>, payload?: object) =>
    app.inject({ method, url, headers, ...(payload ? { payload } : {}) });

  it('lets the gateway act for the company it signs for, and no other', async () => {
    expect((await req('GET', '/v1/policies/tenant_a', as('tenant_a'))).statusCode).toBe(200);
    expect((await req('GET', '/v1/policies/tenant_b', as('tenant_a'))).statusCode).toBe(403);
    expect((await req('POST', '/v1/evaluate', as('tenant_a'), { requestId: 'r', tenantId: 'tenant_b', userId: 'u', modelId: 'm', messages: [] })).statusCode).toBe(403);
    expect((await req('GET', '/v1/policies/tenant_a', {})).statusCode).toBe(401);
    expect((await req('GET', '/health', {})).statusCode).toBe(200);
  });

  it('lets an install\'s reporting agent read framework status only', async () => {
    expect((await req('GET', '/v1/compliance/status/tenant_a', as('tenant_a', 'reporting_agent'))).statusCode).toBe(200);
    expect((await req('GET', '/v1/policies/tenant_a', as('tenant_a', 'reporting_agent'))).statusCode).toBe(403);
    expect((await req('POST', '/v1/compliance/enable/tenant_a/hipaa', as('tenant_a', 'reporting_agent'), {})).statusCode).toBe(403);
  });
});
