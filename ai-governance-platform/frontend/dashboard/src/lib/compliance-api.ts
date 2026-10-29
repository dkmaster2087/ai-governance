import { createApiClient, sessionTenantId } from './http';

const complianceApi = createApiClient('/api/v1/compliance');

const getTenantId = sessionTenantId;

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
