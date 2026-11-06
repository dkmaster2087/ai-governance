import { ComplianceFramework, CompliancePack, ControlAssessment, Policy, PolicyRule, TenantComplianceState } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { allPages, collection } from '@ai-governance/storage';
import { PolicyRepository } from '../repositories/policy.repository';
import { soc2Pack } from './packs/soc2';
import { hipaaPack } from './packs/hipaa';
import { euAiActPack } from './packs/eu-ai-act';

const logger = createLogger('policy-engine:compliance');

export const ALL_PACKS: Record<ComplianceFramework, CompliancePack> = {
  'soc2': soc2Pack,
  'hipaa': hipaaPack,
  'eu-ai-act': euAiActPack,
};

/** Raised when the framework rules change, so companies that turned a framework on earlier can be updated. */
export const RULES_VERSION = 2;

type RuleDefinition = Omit<PolicyRule, 'enabled'> & {
  /** Config fields a company may have filled in itself, kept when its rules are updated. */
  keep?: string[];
};

/** The rules frameworks create. Every rule a framework requires must be defined here (a test checks it). */
export const FRAMEWORK_RULES: Record<string, RuleDefinition> = {
  rule_pii_masking: {
    ruleId: 'rule_pii_masking', type: 'pii_detection', action: 'mask', priority: 3,
    description: 'Flag personal data in prompts (data protection removes it before the prompt leaves)',
    config: {},
  },
  rule_phi_detection: {
    ruleId: 'rule_phi_detection', type: 'pii_detection', action: 'block', priority: 1,
    description: 'Block protected health information: health details together with who they are about',
    config: { phi: true },
  },
  rule_approved_providers: {
    ruleId: 'rule_approved_providers', type: 'model_restriction', action: 'block', priority: 2,
    description: 'Only the models added on the Models page may be used',
    config: { onlyConfiguredModels: true },
  },
  rule_hipaa_approved_providers: {
    ruleId: 'rule_hipaa_approved_providers', type: 'model_restriction', action: 'block', priority: 2,
    description: 'Only models covered by a business associate agreement (BAA) may be used',
    config: { allowedModels: [], needsList: true }, keep: ['allowedModels'],
  },
  rule_harmful_content: {
    ruleId: 'rule_harmful_content', type: 'keyword_block', action: 'warn', priority: 5,
    description: 'Flag requests for attack help (malware, phishing) for review',
    config: { keywords: ['create malware', 'write ransomware', 'phishing template', 'keylogger code', 'ddos script'] }, keep: ['keywords'],
  },
  rule_risk_scoring: {
    ruleId: 'rule_risk_scoring', type: 'data_classification', action: 'warn', priority: 6,
    description: 'Flag prompts that mention credentials for review',
    config: { patterns: ['password', 'secret key', 'api key', 'private key', 'credentials'] }, keep: ['patterns'],
  },
  rule_rate_limit: {
    ruleId: 'rule_rate_limit', type: 'rate_limit', action: 'block', priority: 0,
    description: 'Stop requests over the company’s limits',
    config: { requestsPerMinute: 600, requestsPerDay: 100_000 }, keep: ['requestsPerMinute', 'requestsPerDay'],
  },
};

/** Rules earlier versions created that nothing checked; updating removes them. */
const RETIRED_RULES = new Set([
  'rule_audit_all_requests', 'rule_ai_disclosure', 'rule_log_retention_90d', 'rule_data_minimization', 'rule_model_allowlist', 'rule_auth_required',
]);

const buildRule = (id: string, existing?: PolicyRule): PolicyRule => {
  const def = FRAMEWORK_RULES[id];
  const { keep = [], ...rule } = def;
  const config = { ...rule.config };
  for (const k of keep) {
    const v = existing?.config?.[k];
    if (v !== undefined && !(Array.isArray(v) && v.length === 0)) config[k] = v;
  }
  return { ...rule, config, enabled: existing?.enabled ?? true };
};

/** Where a company stands with one framework, control by control. */
export interface FrameworkAssessment {
  status: TenantComplianceState['status'];
  passedControls: number;
  totalControls: number;
  controls: ControlAssessment[];
  rulesOutdated: boolean;
}

export class ComplianceService {
  private states = () => collection<TenantComplianceState & Record<string, unknown>>('compliance');
  private policyRepo = new PolicyRepository();

  getAllPacks(): CompliancePack[] {
    return Object.values(ALL_PACKS);
  }

  getPack(framework: ComplianceFramework): CompliancePack {
    return ALL_PACKS[framework];
  }

  async getTenantComplianceStates(tenantId: string): Promise<TenantComplianceState[]> {
    try {
      return await allPages((after) => this.states().query({ partition: tenantId, after }));
    } catch {
      logger.warn('Compliance state unavailable, returning empty', { tenantId });
      return [];
    }
  }

  /** Turn a framework on: create its policy, or bring the existing one up to date and switch it on. */
  async enableFramework(tenantId: string, framework: ComplianceFramework, enabledBy: string): Promise<TenantComplianceState & { policyCreated: boolean } & FrameworkAssessment> {
    const pack = ALL_PACKS[framework];
    logger.info('Enabling compliance framework', { tenantId, framework });
    const existing = await this.policyRepo.findByFramework(tenantId, framework);
    let linkedPolicyId: string;
    let policyCreated = false;
    if (existing) {
      linkedPolicyId = (await this.syncPolicy(tenantId, pack, existing, true)).policyId;
    } else {
      linkedPolicyId = (await this.provisionFrameworkPolicies(tenantId, pack, enabledBy)).policyId;
      policyCreated = true;
    }
    const state: TenantComplianceState = {
      tenantId, framework, status: 'enabled', enabledAt: new Date().toISOString(), enabledBy,
      passedControls: 0, totalControls: pack.controls.length, linkedPolicyId,
    };
    await this.states().put(state as TenantComplianceState & Record<string, unknown>);
    const assessment = await this.assess(tenantId, framework);
    return { ...state, ...assessment, policyCreated };
  }

  async disableFramework(tenantId: string, framework: ComplianceFramework): Promise<{ disabledPolicyId?: string }> {
    logger.info('Disabling compliance framework', { tenantId, framework });
    const linkedPolicy = await this.policyRepo.findByFramework(tenantId, framework);
    if (linkedPolicy) await this.policyRepo.setEnabled(linkedPolicy.policyId, tenantId, false);
    await this.states().delete({ tenantId, framework }).catch(() => undefined);
    return { disabledPolicyId: linkedPolicy?.policyId };
  }

  /** Bring a framework's rules up to the current definitions, keeping what the company filled in. */
  async syncFramework(tenantId: string, framework: ComplianceFramework): Promise<FrameworkAssessment & { updated: boolean }> {
    const policy = await this.policyRepo.findByFramework(tenantId, framework);
    if (!policy) return { ...(await this.assess(tenantId, framework)), updated: false };
    await this.syncPolicy(tenantId, ALL_PACKS[framework], policy, policy.enabled);
    return { ...(await this.assess(tenantId, framework)), updated: true };
  }

  private async syncPolicy(tenantId: string, pack: CompliancePack, policy: Policy, enabled: boolean) {
    const byId = new Map(policy.rules.map((r) => [r.ruleId, r]));
    const frameworkRules = pack.requiredRules.map((id) => buildRule(id, byId.get(id)));
    // Rules the company added to this policy itself stay; retired framework rules go.
    const own = policy.rules.filter((r) => !pack.requiredRules.includes(r.ruleId) && !RETIRED_RULES.has(r.ruleId) && !FRAMEWORK_RULES[r.ruleId]);
    const updated = await this.policyRepo.updatePolicy(policy.policyId, {
      tenantId, name: policy.name, description: policy.description, enabled, rules: [...frameworkRules, ...own], sourceFramework: pack.framework,
    });
    await collection('policies').update({ tenantId, policyId: policy.policyId }, { set: { rulesVersion: RULES_VERSION }, ifExists: true });
    logger.info('Framework rules updated', { tenantId, framework: pack.framework, policyId: policy.policyId });
    return updated;
  }

  /** Work out each control from what is actually switched on now. Nothing is claimed from stored counts. */
  async assess(tenantId: string, framework: ComplianceFramework): Promise<FrameworkAssessment> {
    const pack = ALL_PACKS[framework];
    const [policies, tenant] = await Promise.all([
      this.policyRepo.getPoliciesForTenant(tenantId),
      collection('tenants').get({ tenantId }).catch(() => null),
    ]);
    const live = new Map<string, PolicyRule>();
    for (const p of policies) if (p.enabled) for (const r of p.rules) if (r.enabled) live.set(r.ruleId, r);
    const retentionDays = Number((tenant?.settings as { auditLogRetentionDays?: number } | undefined)?.auditLogRetentionDays) || 365;
    const frameworkPolicy = policies.find((p) => p.sourceFramework === framework);
    const rulesOutdated = !!frameworkPolicy && (Number((frameworkPolicy as Policy & { rulesVersion?: number }).rulesVersion) || 1) < RULES_VERSION;

    const controls: ControlAssessment[] = pack.controls.map((c) => {
      const cov = c.coverage ?? { kind: 'gap' as const, note: 'Not covered yet.' };
      if (cov.kind === 'platform') return { controlId: c.controlId, state: 'platform', met: true, note: cov.note };
      if (cov.kind === 'action') return { controlId: c.controlId, state: 'needs_action', met: false, note: cov.note };
      if (cov.kind === 'gap') return { controlId: c.controlId, state: 'gap', met: false, note: cov.note };
      if (cov.kind === 'retention') {
        const ok = retentionDays >= cov.minDays;
        return {
          controlId: c.controlId, state: ok ? 'platform' : 'needs_action', met: ok,
          note: ok ? `${cov.note} Yours: ${retentionDays} days.` : `${cov.note} Yours is ${retentionDays} days; ask your provider to raise it.`,
        };
      }
      // Rules from an earlier version may not check what the control needs: they don't count until updated.
      if (rulesOutdated) return { controlId: c.controlId, state: 'needs_action', met: false, note: 'Update this framework’s rules (button above): the rules it has now are an older version.' };
      const missing = cov.rules.filter((id) => !live.has(id));
      if (missing.length) {
        return { controlId: c.controlId, state: 'needs_action', met: false, note: `Switch on ${missing.map((id) => FRAMEWORK_RULES[id]?.description ?? id).join('; ')} on the Rules page.` };
      }
      const emptyList = cov.rules.map((id) => live.get(id)!).find((r) => r.config.needsList && !((r.config.allowedModels as string[]) ?? []).length);
      if (emptyList) return { controlId: c.controlId, state: 'needs_action', met: false, note: `Add the models covered by your BAA to “${emptyList.description}” on the Rules page.` };
      return { controlId: c.controlId, state: 'enforced', met: true, note: cov.note };
    });

    const passedControls = controls.filter((c) => c.met).length;
    return {
      status: passedControls === controls.length ? 'enabled' : 'partial',
      passedControls,
      totalControls: controls.length,
      controls,
      rulesOutdated,
    };
  }

  /** Kept for the "Check again" button: the same live assessment. */
  async assessCompliance(tenantId: string, framework: ComplianceFramework) {
    return { tenantId, framework, lastAssessedAt: new Date().toISOString(), ...(await this.assess(tenantId, framework)) };
  }

  private async provisionFrameworkPolicies(tenantId: string, pack: CompliancePack, createdBy: string): Promise<{ policyId: string }> {
    const missing = pack.requiredRules.filter((id) => !FRAMEWORK_RULES[id]);
    if (missing.length) throw new Error(`${pack.framework} requires rules that aren't defined: ${missing.join(', ')}`);
    const policy = await this.policyRepo.createPolicy({
      tenantId,
      name: `${pack.name} — Required Controls`,
      description: `Rules for ${pack.framework} compliance.`,
      enabled: true,
      rules: pack.requiredRules.map((id) => buildRule(id)),
      createdBy,
      sourceFramework: pack.framework,
    });
    await collection('policies').update({ tenantId, policyId: policy.policyId }, { set: { rulesVersion: RULES_VERSION }, ifExists: true });
    logger.info('Provisioned compliance policy', { tenantId, framework: pack.framework, policyId: policy.policyId, rules: pack.requiredRules.length });
    return policy;
  }
}
