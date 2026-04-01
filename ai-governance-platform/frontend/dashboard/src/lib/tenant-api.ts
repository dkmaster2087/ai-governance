import axios from 'axios';

const gatewayApi = axios.create({ baseURL: '/api' });

function headers(tenantId: string) {
  return {
    'x-tenant-id': tenantId,
    'x-user-id': 'admin',
    authorization: 'Bearer test-key',
  };
}

// Platform admin — fetch all tenants
export async function fetchTenants(callerTenantId = 'tenant_demo') {
  const { data } = await gatewayApi.get('/v1/tenants', { headers: headers(callerTenantId) });
  return data;
}

// Tenant user — fetch only their own tenant
export async function fetchMyTenant(tenantId: string) {
  const { data } = await gatewayApi.get(`/v1/tenants/${tenantId}`, { headers: headers(tenantId) });
  return data;
}

export async function createTenant(payload: unknown, callerTenantId = 'tenant_demo') {
  const { data } = await gatewayApi.post('/v1/tenants', payload, { headers: headers(callerTenantId) });
  return data;
}

export async function updateTenant(tenantId: string, payload: unknown) {
  const { data } = await gatewayApi.put(`/v1/tenants/${tenantId}`, payload, { headers: headers(tenantId) });
  return data;
}

export async function suspendTenant(tenantId: string, callerTenantId = 'tenant_demo') {
  const { data } = await gatewayApi.post(`/v1/tenants/${tenantId}/suspend`, {}, { headers: headers(callerTenantId) });
  return data;
}

export async function activateTenant(tenantId: string, callerTenantId = 'tenant_demo') {
  const { data } = await gatewayApi.post(`/v1/tenants/${tenantId}/activate`, {}, { headers: headers(callerTenantId) });
  return data;
}
