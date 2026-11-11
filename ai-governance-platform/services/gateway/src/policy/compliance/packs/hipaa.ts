import { CompliancePack } from '@ai-governance/types';

export const hipaaPack: CompliancePack = {
  framework: 'hipaa',
  name: 'HIPAA (Health Insurance Portability and Accountability Act)',
  version: '2013-omnibus',
  description:
    'HIPAA Security and Privacy Rules for AI systems that process Protected Health Information (PHI). Requires a business associate agreement (BAA) with each AI provider.',
  category: 'Healthcare Compliance',
  controls: [
    {
      controlId: 'HIPAA-164.312-A1', framework: 'hipaa', title: 'PHI Detection & Blocking',
      description: 'Protected Health Information (health details together with who they are about) is detected and blocked from AI prompts.',
      severity: 'critical', policyRuleType: 'pii_detection', automatable: true, mappedRuleIds: ['rule_phi_detection', 'rule_pii_masking'],
      coverage: { kind: 'rules', rules: ['rule_phi_detection', 'rule_pii_masking'], note: 'Prompts that pair health details (diagnoses, codes, medications, lab results) with an identifier (record number, date of birth, SSN, member ID, contact details, a patient’s name) are stopped.' },
    },
    {
      controlId: 'HIPAA-164.312-B', framework: 'hipaa', title: 'Audit Controls',
      description: 'All access to AI systems processing PHI is logged with user identity and timestamp.',
      severity: 'critical', policyRuleType: 'audit_logging', automatable: true, mappedRuleIds: [],
      coverage: { kind: 'platform', note: 'Every request gets a case file: who, which app, when, every check and its outcome.' },
    },
    {
      controlId: 'HIPAA-164.316-B2', framework: 'hipaa', title: 'Retention of Records',
      description: 'Required documentation, including audit records, is kept for six years.',
      severity: 'high', policyRuleType: 'data_retention', automatable: true, mappedRuleIds: [],
      coverage: { kind: 'retention', minDays: 6 * 365, note: 'Evidence must be kept at least 6 years.' },
    },
    {
      controlId: 'HIPAA-164.312-C1', framework: 'hipaa', title: 'Data Integrity',
      description: 'AI responses are verified not to introduce or alter clinical information.',
      severity: 'high', policyRuleType: 'response_filter', automatable: false, mappedRuleIds: [],
      coverage: { kind: 'gap', note: 'Probaline removes personal data from answers but doesn’t check them for clinical accuracy. Keep a clinician in the loop.' },
    },
    {
      controlId: 'HIPAA-164.312-E1', framework: 'hipaa', title: 'Transmission Security',
      description: 'PHI transmitted to AI providers is encrypted. Only providers covered by a BAA are permitted.',
      severity: 'critical', policyRuleType: 'model_restriction', automatable: true, mappedRuleIds: ['rule_hipaa_approved_providers'],
      coverage: { kind: 'rules', rules: ['rule_hipaa_approved_providers'], note: 'Only the models you list as covered by a BAA can be used; calls use HTTPS.' },
    },
    {
      controlId: 'HIPAA-164.308-A3', framework: 'hipaa', title: 'Workforce Access Controls',
      description: 'Only authorized staff may use AI features that process PHI.',
      severity: 'critical', policyRuleType: 'access_control', automatable: true, mappedRuleIds: [],
      coverage: { kind: 'platform', note: 'Requests need a scoped key or a signed-in user, and dashboard roles limit who can change settings. Limiting individual models to roles isn’t enforced yet.' },
    },
    {
      controlId: 'HIPAA-164.308-A6', framework: 'hipaa', title: 'Security Incident Procedures',
      description: 'PHI exposure incidents via AI are flagged and escalated.',
      severity: 'critical', policyRuleType: 'audit_logging', automatable: false, mappedRuleIds: [],
      coverage: { kind: 'action', note: 'Stopped PHI is listed on the Stopped page with a case file; your incident procedure needs someone to review it. Automatic escalation isn’t built yet.' },
    },
  ],
  requiredRules: ['rule_phi_detection', 'rule_pii_masking', 'rule_hipaa_approved_providers'],
  recommendedRules: ['rule_rate_limit'],
};
