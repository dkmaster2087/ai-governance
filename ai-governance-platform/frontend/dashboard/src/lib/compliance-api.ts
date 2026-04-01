import axios from 'axios';

const complianceApi = axios.create({ baseURL: '/api/compliance' });

function getTenantId(): string {
  try {
    const stored = localStorage.getItem('aegis_auth_user');
    if (stored) return JSON.parse(stored).tenantId || 'tenant_demo';
  } catch {}
  return 'tenant_demo';
}

export interface EnableResult {
  framework: string;
  status: string;
  linkedPolicyId?: string;
  policyCreated?: boolean;
}

export interface DisableResult {
  disabledPolicyId?: string;
}

export async function fetchComplianceStatus() {
  const { data } = await complianceApi.get(`/status/${getTenantId()}`);
  return data;
}

export async function enableFramework(framework: string): Promise<EnableResult> {
  const { data } = await complianceApi.post(
    `/enable/${getTenantId()}/${framework}`,
    { enabledBy: 'admin' }
  );
  return data;
}

export async function disableFramework(framework: string): Promise<DisableResult> {
  const { data } = await complianceApi.delete(`/disable/${getTenantId()}/${framework}`);
  return data;
}

export async function assessFramework(framework: string) {
  const { data } = await complianceApi.post(`/assess/${getTenantId()}/${framework}`);
  return data;
}
