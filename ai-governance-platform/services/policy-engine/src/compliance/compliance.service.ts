import { ComplianceFramework, CompliancePack, TenantComplianceState } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { PolicyRepository } from '../repositories/policy.repository';
import { nistAiRmfPack } from './packs/nist-ai-rmf';
import { soc2Pack } from './packs/soc2';
import { gdprPack } from './packs/gdpr';
import { hipaaPack } from './packs/hipaa';
import { iso42001Pack } from './packs/iso-42001';
import { pipedaPack } from './packs/pipeda';

const logger = createLogger('policy-engine:compliance');

export const ALL_PACKS: Record<ComplianceFramework, CompliancePack> = {
  'nist-ai-rmf': nistAiRmfPack,
  'soc2': soc2Pack,
  'gdpr': gdprPack,
  'hipaa': hipaaPack,
  'iso-42001': iso42001Pack,
  'pipeda': pipedaPack,
};

// Pre-built policy rules that get created when a framework is enabled
const FRAMEWORK_RULES: Record<string, object> = {
  rule_pii_masking: {
    ruleId: 'rule_pii_masking',
    type: 'pii_detection',
    action: 'mask',
    priority: 1,
    enabled: true,
    description: 'Detect and mask PII in all prompts',
    config: {},
  },
  rule_model_allowlist: {
    ruleId: 'rule_model_allowlist',
    type: 'model_restriction',
    action: 'block',
    priority: 2,
    enabled: true,
    description: 'Only allow approved AI models',
    config: {
      allowedModels: [
        'anthropic.claude-3-sonnet-20240229-v1:0',
        'anthropic.claude-3-haiku-20240307-v1:0',
        'amazon.titan-text-express-v1',
      ],
    },
  },
  rule_harmful_content: {
    ruleId: 'rule_harmful_content',
    type: 'keyword_block',
    action: 'block',
    priority: 3,
    enabled: true,
    description: 'Block harmful, violent, or illegal content',
    config: {
      keywords: [
        'how to hack', 'exploit vulnerability', 'bypass security',
        'create malware', 'phishing template',
      ],
    },
  },
  rule_audit_all_requests: {
    ruleId: 'rule_audit_all_requests',
    type: 'audit_logging',
    action: 'allow',
    priority: 10,
    enabled: true,
    description: 'Log all AI requests for compliance audit trail',
    config: { logLevel: 'full' },
  },
  rule_rate_limit: {
    ruleId: 'rule_rate_limit',
    type: 'rate_limit',
    action: 'block',
    priority: 5,
    enabled: true,
    description: 'Enforce rate limits to prevent abuse',
    config: { requestsPerMinute: 100, requestsPerDay: 10000 },
  },
  rule_eu_data_residency: {
    ruleId: 'rule_eu_data_residency',
    type: 'region_restriction',
    action: 'block',
    priority: 1,
    enabled: true,
    description: 'Block requests that would send EU personal data outside EU regions',
    config: { allowedRegions: ['eu-west-1', 'eu-central-1', 'eu-west-3'] },
  },
  rule_phi_detection: {
    ruleId: 'rule_phi_detection',
    type: 'pii_detection',
    action: 'block',
    priority: 1,
    enabled: true,
    description: 'Block prompts containing Protected Health Information (PHI)',
    config: {
      piiTypes: ['NAME', 'DATE_OF_BIRTH', 'MEDICAL_RECORD_NUMBER', 'DIAGNOSIS', 'MEDICATION'],
      action: 'block',
    },
  },
  rule_risk_scoring: {
    ruleId: 'rule_risk_scoring',
    type: 'data_classification',
    action: 'warn',
    priority: 4,
    enabled: true,
    description: 'Score prompt risk level and flag high-risk requests',
    config: {
      patterns: ['password', 'secret key', 'api key', 'private key', 'credentials'],
    },
  },
  rule_data_minimization: {
    ruleId: 'rule_data_minimization',
    type: 'pii_detection',
    action: 'mask',
    priority: 2,
    enabled: true,
    description: 'Enforce data minimization — mask all detected personal data',
    config: {},
  },
  rule_log_retention_90d: {
    ruleId: 'rule_log_retention_90d',
    type: 'data_retention',
    action: 'allow',
    priority: 10,
    enabled: true,
    description: 'Enforce 90-day log retention for compliance',
    config: { retentionDays: 90 },
  },
};

export class ComplianceService {
  private client: DynamoDBDocumentClient;
  private complianceTable = process.env.COMPLIANCE_TABLE || 'ai-gov-compliance-dev';
  private policyRepo = new PolicyRepository();

  constructor() {
    const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
    this.client = DynamoDBDocumentClient.from(dynamo);
  }

  getAllPacks(): CompliancePack[] {
    return Object.values(ALL_PACKS);
  }

  getPack(framework: ComplianceFramework): CompliancePack {
    return ALL_PACKS[framework];
  }

  async getTenantComplianceStates(tenantId: string): Promise<TenantComplianceState[]> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.complianceTable,
          KeyConditionExpression: 'tenantId = :tid',
          ExpressionAttributeValues: { ':tid': tenantId },
        })
      );
      return (result.Items || []) as TenantComplianceState[];
    } catch (err) {
      // Table may not exist yet in dev — return empty gracefully
      logger.warn('Compliance table not available, returning empty state', { tenantId });
      return [];
    }
  }

  async enableFramework(tenantId: string, framework: ComplianceFramework, enabledBy: string): Promise<TenantComplianceState & { policyCreated: boolean }> {
    const pack = ALL_PACKS[framework];
    logger.info('Enabling compliance framework', { tenantId, framework });

    // Check if a linked policy already exists
    const existingPolicy = await this.policyRepo.findByFramework(tenantId, framework);
    let linkedPolicyId: string;
    let policyCreated = false;

    if (existingPolicy) {
      // Re-enable the existing linked policy
      await this.policyRepo.setEnabled(existingPolicy.policyId, tenantId, true);
      linkedPolicyId = existingPolicy.policyId;
      logger.info('Re-enabled existing framework policy', { tenantId, framework, policyId: linkedPolicyId });
    } else {
      // Create a new policy with all required rules
      const policy = await this.provisionFrameworkPolicies(tenantId, pack, enabledBy);
      linkedPolicyId = policy.policyId;
      policyCreated = true;
    }

    const state: TenantComplianceState = {
      tenantId,
      framework,
      status: 'enabled',
      enabledAt: new Date().toISOString(),
      enabledBy,
      passedControls: pack.requiredRules.length,
      totalControls: pack.controls.length,
      lastAssessedAt: new Date().toISOString(),
      linkedPolicyId,
    };

    try {
      await this.client.send(
        new PutCommand({ TableName: this.complianceTable, Item: state })
      );
    } catch (err) {
      logger.warn('Could not persist compliance state (table may not exist), continuing', { framework });
    }

    return { ...state, policyCreated };
  }

  async disableFramework(tenantId: string, framework: ComplianceFramework): Promise<{ disabledPolicyId?: string }> {
    logger.info('Disabling compliance framework', { tenantId, framework });

    // Find and disable the linked policy (don't delete it)
    const linkedPolicy = await this.policyRepo.findByFramework(tenantId, framework);
    let disabledPolicyId: string | undefined;

    if (linkedPolicy) {
      await this.policyRepo.setEnabled(linkedPolicy.policyId, tenantId, false);
      disabledPolicyId = linkedPolicy.policyId;
      logger.info('Disabled linked policy', { tenantId, framework, policyId: disabledPolicyId });
    }

    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.complianceTable,
          Key: { tenantId, framework },
        })
      );
    } catch (err) {
      logger.warn('Could not delete compliance state (table may not exist)', { framework });
    }

    return { disabledPolicyId };
  }

  async assessCompliance(tenantId: string, framework: ComplianceFramework): Promise<TenantComplianceState> {
    const pack = ALL_PACKS[framework];
    const policies = await this.policyRepo.getPoliciesForTenant(tenantId);
    const allRuleIds = policies.flatMap((p) => p.rules.map((r) => r.ruleId));

    const passedControls = pack.controls.filter((c) =>
      c.mappedRuleIds.length === 0 || c.mappedRuleIds.some((rid) => allRuleIds.includes(rid))
    ).length;

    const status: TenantComplianceState['status'] =
      passedControls === pack.controls.length ? 'enabled' :
      passedControls > 0 ? 'partial' : 'disabled';

    const state: TenantComplianceState = {
      tenantId,
      framework,
      status,
      passedControls,
      totalControls: pack.controls.length,
      lastAssessedAt: new Date().toISOString(),
    };

    await this.client.send(new PutCommand({ TableName: this.complianceTable, Item: state }));
    return state;
  }

  private async provisionFrameworkPolicies(tenantId: string, pack: CompliancePack, createdBy: string): Promise<{ policyId: string }> {
    const requiredRules = pack.requiredRules
      .map((ruleId) => FRAMEWORK_RULES[ruleId])
      .filter(Boolean);

    const policy = await this.policyRepo.createPolicy({
      tenantId,
      name: `${pack.name} — Required Controls`,
      description: `Auto-generated policy for ${pack.framework} compliance. Contains ${requiredRules.length} required rules.`,
      enabled: true,
      rules: requiredRules as any,
      createdBy,
      sourceFramework: pack.framework,
    });

    logger.info('Provisioned compliance policies', {
      tenantId,
      framework: pack.framework,
      policyId: policy.policyId,
      rulesCreated: requiredRules.length,
    });

    return policy;
  }
}
