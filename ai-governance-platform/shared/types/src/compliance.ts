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
  /** How the control is met, so the dashboard never claims more than is true. */
  coverage?: ControlCoverage;
}

/**
 * - rules: met when every listed rule exists, is on, and its policy is on (and an allowlist isn't empty)
 * - platform: Probaline does it for every company (audit records, sign-in, encryption in transit)
 * - retention: met when the company keeps evidence at least this long
 * - action: the company has to do something outside Probaline (contracts, procedures)
 * - gap: Probaline doesn't cover it yet
 */
export type ControlCoverage =
  | { kind: 'rules'; rules: string[]; note: string }
  | { kind: 'platform'; note: string }
  | { kind: 'retention'; minDays: number; note: string }
  | { kind: 'action'; note: string }
  | { kind: 'gap'; note: string };

/** A control's state for one company, worked out on every check. */
export type ControlState = 'enforced' | 'platform' | 'needs_action' | 'gap';

export interface ControlAssessment {
  controlId: string;
  state: ControlState;
  /** Counted as in place: enforced, or provided by the platform. */
  met: boolean;
  note: string;
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
