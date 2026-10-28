export type ComplianceFramework = 'soc2' | 'hipaa' | 'eu-ai-act';

export type ComplianceStatus = 'enabled' | 'disabled' | 'partial';

export type ControlSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ComplianceControl {
  controlId: string;
  framework: ComplianceFramework;
  title: string;
  description: string;
  severity: ControlSeverity;
  policyRuleType: string;
  automatable: boolean;
  mappedRuleIds: string[];
}

export interface CompliancePack {
  framework: ComplianceFramework;
  name: string;
  version: string;
  description: string;
  category: string;
  controls: ComplianceControl[];
  requiredRules: string[];
  recommendedRules: string[];
}

export interface TenantComplianceState {
  tenantId: string;
  framework: ComplianceFramework;
  status: ComplianceStatus;
  enabledAt?: string;
  enabledBy?: string;
  passedControls: number;
  totalControls: number;
  lastAssessedAt?: string;
  linkedPolicyId?: string;
}
