import { createApiClient, sessionTenantId } from './http';

// The dashboard talks to the gateway at /api/… (proxied in dev). /analytics is the platform-only analytics service.
const gateway = createApiClient('/api');
const policyApi = createApiClient('/api/v1/policies');

/** Gateway base URL for direct (non-proxied) requests */
export function getGatewayUrl(): string {
  return window.location.origin.replace('5174', '3000');
}

/** The signed-in user's tenant. */
export function getAuthTenantId(): string {
  return sessionTenantId();
}

const headers = () => ({
  'x-tenant-id': getAuthTenantId(),
});

// ── Policies (through the gateway, always the signed-in user's tenant) ──────────
export async function fetchPolicies() {
  const { data } = await policyApi.get('');
  return data;
}

export async function createPolicy(payload: unknown) {
  const { data } = await policyApi.post('', payload);
  return data;
}

export async function updatePolicy(policyId: string, payload: unknown) {
  const { data } = await policyApi.put(`/${encodeURIComponent(policyId)}`, payload);
  return data;
}

export async function deletePolicy(policyId: string) {
  await policyApi.delete(`/${encodeURIComponent(policyId)}`);
}

export async function updatePolicyEnabled(policyId: string, enabled: boolean) {
  const { data } = await policyApi.put(`/${encodeURIComponent(policyId)}`, { enabled });
  return data;
}

export async function fetchModels() {
  const { data } = await gateway.get('/v1/models', { headers: headers() });
  return data;
}

export async function fetchModelConfigs() {
  const { data } = await gateway.get('/v1/models/config', { headers: headers() });
  return data;
}

export async function createModelConfig(payload: unknown) {
  const { data } = await gateway.post('/v1/models/config', payload, { headers: headers() });
  return data;
}

export async function updateModelConfig(modelConfigId: string, payload: unknown) {
  const { data } = await gateway.put(`/v1/models/config/${modelConfigId}`, payload, { headers: headers() });
  return data;
}

export async function deleteModelConfig(modelConfigId: string) {
  await gateway.delete(`/v1/models/config/${modelConfigId}`, { headers: headers() });
}

export async function testModelConfig(modelConfigId: string) {
  const { data } = await gateway.post(`/v1/models/config/${modelConfigId}/test`, {}, { headers: headers() });
  return data;
}

// ── Cost Analytics ────────────────────────────────────────────────────────────
export async function fetchCostSummary(tenantId: string, period = '30d') {
  const { data } = await gateway.get(`/v1/cost/summary/${tenantId}`, {
    params: { period },
    headers: headers(),
  });
  return data;
}

export async function fetchCostDailyBreakdown(tenantId: string, period = '30d') {
  const { data } = await gateway.get(`/v1/cost/breakdown/${tenantId}`, {
    params: { period },
    headers: headers(),
  });
  return data;
}

export async function fetchCostUsers(tenantId: string, period = '30d') {
  const { data } = await gateway.get(`/v1/cost/users/${tenantId}`, {
    params: { period },
    headers: headers(),
  });
  return data;
}
