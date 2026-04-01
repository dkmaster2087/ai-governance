import axios from 'axios';

// In dev, Vite proxies /api → gateway, /analytics → analytics, /api/policies → policy-engine
const gateway = axios.create({ baseURL: '/api' });
const analytics = axios.create({ baseURL: '/analytics' });
const policyApi = axios.create({ baseURL: '/api/policies' });

/** Get tenantId from localStorage auth */
function getAuthTenantId(): string {
  try {
    const stored = localStorage.getItem('aegis_auth_user');
    if (stored) return JSON.parse(stored).tenantId || 'tenant_demo';
  } catch {}
  return 'tenant_demo';
}

const headers = () => ({
  'x-tenant-id': getAuthTenantId(),
  authorization: 'Bearer test-key',
});

// ── Metrics ──────────────────────────────────────────────────────────────────
export async function fetchSummary(period = '7d') {
  const { data } = await analytics.get(`/v1/metrics/${getAuthTenantId()}/summary`, {
    params: { period },
  });
  return data;
}

export async function fetchCostBreakdown(from?: string, to?: string) {
  const { data } = await analytics.get(`/v1/metrics/${getAuthTenantId()}/cost`, {
    params: { from, to },
  });
  return data;
}

export async function fetchModelDistribution() {
  const { data } = await analytics.get(`/v1/metrics/${getAuthTenantId()}/models`);
  return data;
}

export async function fetchViolations() {
  const { data } = await analytics.get(`/v1/metrics/${getAuthTenantId()}/violations`);
  return data;
}

// ── Audit Logs ────────────────────────────────────────────────────────────────
export async function fetchAuditLogs(params?: {
  from?: string;
  to?: string;
  userId?: string;
  limit?: number;
}) {
  const { data } = await analytics.get(`/v1/logs/${getAuthTenantId()}`, { params });
  return data;
}

// ── Policies ──────────────────────────────────────────────────────────────────
export async function fetchPolicies() {
  const { data } = await policyApi.get(`/${getAuthTenantId()}`);
  return data;
}

export async function createPolicy(payload: unknown) {
  const { data } = await policyApi.post('/', payload);
  return data;
}

export async function updatePolicy(policyId: string, payload: unknown) {
  const body = payload as any;
  const tenantId = body.tenantId ?? getAuthTenantId();
  const { data } = await policyApi.put(`/${tenantId}/${policyId}`, payload);
  return data;
}

export async function deletePolicy(policyId: string, tenantId = getAuthTenantId()) {
  await policyApi.delete(`/${tenantId}/${policyId}`);
}

export async function updatePolicyEnabled(policyId: string, enabled: boolean) {
  const tenantId = getAuthTenantId();
  const { data } = await policyApi.put(`/${tenantId}/${policyId}`, {
    tenantId,
    enabled,
  });
  return data;
}

// ── Models ────────────────────────────────────────────────────────────────────
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
