import axios from 'axios';

// /compliance proxy → http://localhost:3001/v1/compliance
const complianceApi = axios.create({ baseURL: '/compliance' });
const TENANT_ID = 'tenant_demo';

export async function fetchComplianceStatus(tenantId = TENANT_ID) {
  const { data } = await complianceApi.get(`/status/${tenantId}`);
  return data;
}

export async function enableFramework(framework: string, tenantId = TENANT_ID) {
  const { data } = await complianceApi.post(
    `/enable/${tenantId}/${framework}`,
    { enabledBy: 'admin' }
  );
  return data;
}

export async function disableFramework(framework: string, tenantId = TENANT_ID) {
  await complianceApi.delete(`/disable/${tenantId}/${framework}`);
}

export async function assessFramework(framework: string, tenantId = TENANT_ID) {
  const { data } = await complianceApi.post(`/assess/${tenantId}/${framework}`);
  return data;
}
