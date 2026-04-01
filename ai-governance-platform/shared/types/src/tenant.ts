export type DeploymentMode = 'saas' | 'onprem';
export type TenantPlan = 'starter' | 'professional' | 'enterprise';
export type TenantStatus = 'active' | 'suspended' | 'trial';

export interface Tenant {
  tenantId: string;
  name: string;
  plan: TenantPlan;
  status: TenantStatus;
  deploymentMode: DeploymentMode;
  region: string;
  createdAt: string;
  updatedAt: string;
  settings: TenantSettings;
}

export interface TenantSettings {
  allowedModels: string[];
  maxTokensPerRequest: number;
  maxRequestsPerMinute: number;
  dataResidencyRegion: string;
  piiMaskingEnabled: boolean;
  auditLogRetentionDays: number;
  allowExternalProviders: boolean;
}
