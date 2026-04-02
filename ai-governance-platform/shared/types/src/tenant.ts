export type DeploymentMode = 'saas' | 'onprem';
export type TenantPlan = 'starter' | 'professional' | 'enterprise';
export type TenantStatus = 'active' | 'suspended' | 'trial';
export type BillingPlan = 'free' | 'starter' | 'professional' | 'enterprise';

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
  billing?: TenantBilling;
}

export interface TenantBilling {
  billingPlan: BillingPlan;
  monthlyBudgetUSD: number;
  costMarkupPercent: number;
  billingAlertThresholdPercent: number;
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
