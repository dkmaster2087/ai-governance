import { CompliancePack } from '@ai-governance/types';

export const soc2Pack: CompliancePack = {
  framework: 'soc2',
  name: 'SOC 2 Type II',
  version: '2017',
  description:
    'SOC 2 Trust Services Criteria covering Security, Availability, Processing Integrity, Confidentiality, and Privacy for AI systems.',
  category: 'Security & Audit',
  controls: [
    {
      controlId: 'SOC2-CC6.1', framework: 'soc2', title: 'Logical Access Controls',
      description: 'Access to AI systems is restricted to authorized users via API keys and tenant isolation.',
      severity: 'critical', policyRuleType: 'access_control', automatable: true, mappedRuleIds: [],
      coverage: { kind: 'platform', note: 'Every request needs a scoped API key or a signed-in user; companies are kept apart; dashboard roles limit who changes what.' },
    },
    {
      controlId: 'SOC2-CC6.7', framework: 'soc2', title: 'Data Transmission Encryption',
      description: 'All data transmitted to and from AI providers is encrypted in transit.',
      severity: 'critical', policyRuleType: 'encryption', automatable: true, mappedRuleIds: [],
      coverage: { kind: 'platform', note: 'Calls to AI providers use HTTPS; the gateway is served over HTTPS (production requires a certificate).' },
    },
    {
      controlId: 'SOC2-CC7.2', framework: 'soc2', title: 'Anomaly & Threat Detection',
      description: 'Unusual AI usage patterns trigger alerts for security review.',
      severity: 'high', policyRuleType: 'rate_limit', automatable: true, mappedRuleIds: [],
      coverage: { kind: 'action', note: 'Set up alerts on the Alerts page (many requests stopped, unapproved AI tools, personal data in answers) and have someone review them; stopped requests and shadow AI are also on the dashboard.' },
    },
    {
      controlId: 'SOC2-CC9.1', framework: 'soc2', title: 'Vendor Risk Management',
      description: 'Only approved AI vendors may be used. New vendors require review.',
      severity: 'high', policyRuleType: 'model_restriction', automatable: true, mappedRuleIds: ['rule_approved_providers'],
      coverage: { kind: 'rules', rules: ['rule_approved_providers'], note: 'Only the models your admins added on the Models page can be used; anything else is stopped, including in IDE proxy traffic.' },
    },
    {
      controlId: 'SOC2-P3.1', framework: 'soc2', title: 'Sensitive Data in AI Prompts',
      description: 'Confidential data is detected and masked before being sent to external AI providers.',
      severity: 'critical', policyRuleType: 'pii_detection', automatable: true, mappedRuleIds: ['rule_pii_masking'],
      coverage: { kind: 'rules', rules: ['rule_pii_masking'], note: 'Personal data is flagged by this rule and removed by data protection before prompts leave.' },
    },
    {
      controlId: 'SOC2-A1.1', framework: 'soc2', title: 'Availability & Rate Limiting',
      description: 'Rate limits prevent abuse and ensure AI services remain available to all users.',
      severity: 'medium', policyRuleType: 'rate_limit', automatable: true, mappedRuleIds: ['rule_rate_limit'],
      coverage: { kind: 'rules', rules: ['rule_rate_limit'], note: 'Requests over the company’s per-minute and per-day limits are stopped.' },
    },
  ],
  requiredRules: ['rule_pii_masking', 'rule_approved_providers', 'rule_rate_limit'],
  recommendedRules: ['rule_risk_scoring'],
};
