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
  /**
   * What happens when the policy engine or data protection service is unreachable.
   * 'closed' (default) blocks the request; 'open' lets it through and flags it in the audit log.
   */
  governanceFailMode?: 'open' | 'closed';
  /**
   * What the gateway does when a prompt contains a credential (API key, token, private key, password).
   * 'block' (default) stops the request; 'redact' replaces the secret and sends the rest; 'off' skips the check.
   */
  secretsAction?: 'block' | 'redact' | 'off';
}
