import { createApiClient, sessionTenantId } from './http';

const gatewayApi = createApiClient('/api');

function headers(tenantId: string) {
  return {
    'x-tenant-id': tenantId,
  };
}

// Platform admin — fetch all tenants
export async function fetchTenants(callerTenantId = sessionTenantId()) {
  const { data } = await gatewayApi.get('/v1/tenants', { headers: headers(callerTenantId) });
  return data;
}

// Tenant user — fetch only their own tenant
export async function fetchMyTenant(tenantId: string) {
  const { data } = await gatewayApi.get(`/v1/tenants/${tenantId}`, { headers: headers(tenantId) });
  return data;
}

export async function createTenant(payload: unknown, callerTenantId = sessionTenantId()) {
  const { data } = await gatewayApi.post('/v1/tenants', payload, { headers: headers(callerTenantId) });
  return data;
}

export async function updateTenant(tenantId: string, payload: unknown) {
  const { data } = await gatewayApi.put(`/v1/tenants/${tenantId}`, payload, { headers: headers(tenantId) });
  return data;
}

export async function suspendTenant(tenantId: string, callerTenantId = sessionTenantId()) {
  const { data } = await gatewayApi.post(`/v1/tenants/${tenantId}/suspend`, {}, { headers: headers(callerTenantId) });
  return data;
}

export async function activateTenant(tenantId: string, callerTenantId = sessionTenantId()) {
  const { data } = await gatewayApi.post(`/v1/tenants/${tenantId}/activate`, {}, { headers: headers(callerTenantId) });
  return data;
}

export interface LegalHold { on: boolean; since: string; by: string; reason: string }

/** Place or release a legal hold: while on, none of the company's evidence is deleted. */
export async function setLegalHold(tenantId: string, on: boolean, reason?: string): Promise<{ legalHold: LegalHold }> {
  const { data } = await gatewayApi.put(`/v1/tenants/${encodeURIComponent(tenantId)}/legal-hold`, { on, ...(reason ? { reason } : {}) }, { headers: headers(tenantId) });
  return data;
}
