/**
 * Rich detail for each compliance control — what it blocks, why, and example prompts.
 * Keyed by controlId.
 */
export interface ControlDetail {
  controlId: string;
  what: string;           // Plain-language description of what is blocked/enforced
  why: string;            // Regulatory rationale
  blockedExamples: string[];   // Example prompts that would be caught
  allowedExamples: string[];   // Example prompts that would pass
  ruleConfig: Record<string, unknown>; // Default rule config when copied
}

export const CONTROL_DETAILS: Record<string, ControlDetail> = {
  // ── NIST AI RMF ────────────────────────────────────────────────────────────
  'NIST-GOVERN-1.1': {
    controlId: 'NIST-GOVERN-1.1',
    what: 'Every AI request is logged with full context — user, tenant, model, prompt hash, and policy decision.',
    why: 'NIST AI RMF GOVERN function requires documented policies and evidence of their enforcement.',
    blockedExamples: [],
    allowedExamples: ['All requests pass through — this control enables logging, not blocking.'],
    ruleConfig: { type: 'audit_logging', action: 'allow', config: { logLevel: 'full' } },
  },
  'NIST-GOVERN-1.2': {
    controlId: 'NIST-GOVERN-1.2',
    what: 'Requests to AI models not on the approved list are blocked. Only explicitly allowlisted models may be used.',
    why: 'NIST AI RMF requires organizations to maintain an inventory of approved AI systems and prevent use of unapproved ones.',
    blockedExamples: [
      'Using gpt-3.5-turbo when only Claude 3 is approved',
      'Calling a custom fine-tuned model not in the allowlist',
      'Routing to a new provider without governance review',
    ],
    allowedExamples: [
      'Request to anthropic.claude-3-haiku (approved)',
      'Request to amazon.titan-text-express-v1 (approved)',
    ],
    ruleConfig: {
      type: 'model_restriction', action: 'block',
      config: { allowedModels: ['anthropic.claude-3-sonnet-20240229-v1:0', 'anthropic.claude-3-haiku-20240307-v1:0', 'amazon.titan-text-express-v1'] },
    },
  },
  'NIST-MAP-1.1': {
    controlId: 'NIST-MAP-1.1',
    what: 'Prompts containing sensitive patterns (credentials, keys, internal data markers) are flagged with a risk score.',
    why: 'NIST MAP function requires identifying and categorizing AI risks before they materialize.',
    blockedExamples: [
      '"Here is our AWS secret key: AKIA..." — flagged as high risk',
      '"The password for the prod database is..." — flagged',
      '"Internal only: Q3 revenue projections are..." — flagged',
    ],
    allowedExamples: [
      '"Summarize this public article about AI"',
      '"Write a Python function to sort a list"',
    ],
    ruleConfig: {
      type: 'data_classification', action: 'warn',
      config: { patterns: ['password', 'secret key', 'api key', 'private key', 'credentials', 'internal only'] },
    },
  },
  'NIST-MEASURE-2.1': {
    controlId: 'NIST-MEASURE-2.1',
    what: 'Prompts containing harmful, violent, or security-bypass content are blocked before reaching any AI model.',
    why: 'NIST MEASURE function requires evaluating AI outputs for bias and harmful content.',
    blockedExamples: [
      '"How do I hack into a corporate network?"',
      '"Write a phishing email template for..."',
      '"How to create malware that bypasses antivirus"',
      '"Explain how to exploit this SQL injection vulnerability"',
    ],
    allowedExamples: [
      '"What are best practices for network security?"',
      '"How do I protect against phishing attacks?"',
    ],
    ruleConfig: {
      type: 'keyword_block', action: 'block',
      config: { keywords: ['how to hack', 'exploit vulnerability', 'bypass security', 'create malware', 'phishing template'] },
    },
  },
  'NIST-MANAGE-1.1': {
    controlId: 'NIST-MANAGE-1.1',
    what: 'All policy violations are logged with full context for incident response and forensic review.',
    why: 'NIST MANAGE function requires documented incident response procedures with evidence.',
    blockedExamples: [],
    allowedExamples: ['Violations are logged — this control does not block requests.'],
    ruleConfig: { type: 'audit_logging', action: 'allow', config: { logLevel: 'violations_only' } },
  },
  'NIST-MANAGE-2.1': {
    controlId: 'NIST-MANAGE-2.1',
    what: 'Requests exceeding per-tenant cost thresholds trigger alerts. Anomalous usage patterns are flagged.',
    why: 'NIST MANAGE requires monitoring AI system performance and costs to detect misuse.',
    blockedExamples: [
      'A single user making 10,000 requests in an hour',
      'Monthly cost exceeding configured threshold',
    ],
    allowedExamples: ['Normal usage within configured limits'],
    ruleConfig: { type: 'cost_limit', action: 'warn', config: { monthlyLimitUSD: 500, alertThresholdPercent: 80 } },
  },

  // ── SOC 2 ──────────────────────────────────────────────────────────────────
  'SOC2-CC6.1': {
    controlId: 'SOC2-CC6.1',
    what: 'All AI API requests require a valid API key and tenant ID. Unauthenticated requests are rejected with 401.',
    why: 'SOC 2 CC6.1 requires logical access controls to restrict system access to authorized users.',
    blockedExamples: [
      'Request with no Authorization header',
      'Request with expired or revoked API key',
      'Request with mismatched tenant ID',
    ],
    allowedExamples: ['Request with valid Bearer token and matching x-tenant-id header'],
    ruleConfig: { type: 'access_control', action: 'block', config: { requireApiKey: true, requireTenantId: true } },
  },
  'SOC2-CC6.7': {
    controlId: 'SOC2-CC6.7',
    what: 'All traffic to AI providers must use TLS 1.2+. HTTP connections are rejected.',
    why: 'SOC 2 CC6.7 requires encryption of data in transit to protect against interception.',
    blockedExamples: ['HTTP (non-TLS) connections to AI providers', 'TLS 1.0 or 1.1 connections'],
    allowedExamples: ['HTTPS connections using TLS 1.2 or 1.3'],
    ruleConfig: { type: 'encryption', action: 'block', config: { minTlsVersion: '1.2' } },
  },
  'SOC2-CC7.2': {
    controlId: 'SOC2-CC7.2',
    what: 'Unusual request patterns — sudden spikes, off-hours bulk requests, or requests from new IPs — trigger security alerts.',
    why: 'SOC 2 CC7.2 requires monitoring for anomalies that could indicate a security incident.',
    blockedExamples: [
      '500 requests in 60 seconds from a single user',
      'Bulk data extraction patterns in prompts',
    ],
    allowedExamples: ['Normal usage within baseline patterns'],
    ruleConfig: { type: 'rate_limit', action: 'warn', config: { requestsPerMinute: 60, burstLimit: 100 } },
  },
  'SOC2-CC9.1': {
    controlId: 'SOC2-CC9.1',
    what: 'Only AI providers with signed vendor agreements (Bedrock, OpenAI) are permitted. Requests to unapproved providers are blocked.',
    why: 'SOC 2 CC9.1 requires vendor risk management — only assessed and approved third parties may be used.',
    blockedExamples: [
      'Requests routed to an unapproved AI API endpoint',
      'Use of a new AI provider without security review',
    ],
    allowedExamples: ['Requests to Amazon Bedrock (approved)', 'Requests to OpenAI (approved with DPA)'],
    ruleConfig: {
      type: 'model_restriction', action: 'block',
      config: { allowedProviders: ['bedrock', 'openai'] },
    },
  },
  'SOC2-P3.1': {
    controlId: 'SOC2-P3.1',
    what: 'Emails, phone numbers, SSNs, credit card numbers, and other PII are detected and masked before being sent to any AI provider.',
    why: 'SOC 2 Privacy criterion P3.1 requires that personal information is collected and used only for its stated purpose.',
    blockedExamples: [
      '"The customer\'s email is john@example.com and SSN is 123-45-6789"',
      '"Process this credit card: 4111 1111 1111 1111"',
      '"Patient DOB: 1985-03-15, diagnosis: Type 2 diabetes"',
    ],
    allowedExamples: [
      '"The customer\'s email is [REDACTED] and SSN is [REDACTED]" (after masking)',
      '"Summarize this support ticket" (no PII present)',
    ],
    ruleConfig: { type: 'pii_detection', action: 'mask', config: {} },
  },
  'SOC2-A1.1': {
    controlId: 'SOC2-A1.1',
    what: 'Per-tenant rate limits prevent any single tenant from consuming excessive resources and degrading service for others.',
    why: 'SOC 2 Availability criterion A1.1 requires capacity management to meet availability commitments.',
    blockedExamples: ['Tenant exceeding 100 requests/minute', 'Tenant exceeding 1M requests/month on Starter plan'],
    allowedExamples: ['Requests within configured rate limits'],
    ruleConfig: { type: 'rate_limit', action: 'block', config: { requestsPerMinute: 100, requestsPerDay: 10000 } },
  },

  // ── GDPR ───────────────────────────────────────────────────────────────────
  'GDPR-ART5-1C': {
    controlId: 'GDPR-ART5-1C',
    what: 'Personal data in prompts is minimized — only data strictly necessary for the AI task is permitted. Excess PII is masked.',
    why: 'GDPR Article 5(1)(c) data minimization principle: personal data must be adequate, relevant, and limited to what is necessary.',
    blockedExamples: [
      '"Here is the full customer record including name, address, DOB, and purchase history — summarize it"',
      'Sending a full CRM export to an AI for analysis',
    ],
    allowedExamples: [
      '"Summarize this support ticket" (ticket ID only, no PII)',
      '"Classify this feedback as positive or negative" (anonymized)',
    ],
    ruleConfig: { type: 'pii_detection', action: 'mask', config: {} },
  },
  'GDPR-ART5-1E': {
    controlId: 'GDPR-ART5-1E',
    what: 'Audit logs containing personal data are automatically purged after the configured retention period (default 90 days).',
    why: 'GDPR Article 5(1)(e) storage limitation: personal data must not be kept longer than necessary.',
    blockedExamples: [],
    allowedExamples: ['Logs are retained for 90 days then automatically deleted.'],
    ruleConfig: { type: 'data_retention', action: 'allow', config: { retentionDays: 90 } },
  },
  'GDPR-ART25': {
    controlId: 'GDPR-ART25',
    what: 'PII masking is applied by default to ALL requests. No opt-out without explicit documented justification.',
    why: 'GDPR Article 25 Privacy by Design: data protection must be built into systems by default, not added later.',
    blockedExamples: [
      'Any request containing personal data without masking enabled',
    ],
    allowedExamples: ['All requests — PII is masked automatically before reaching AI providers'],
    ruleConfig: { type: 'pii_detection', action: 'mask', config: { enforceDefault: true } },
  },
  'GDPR-ART32': {
    controlId: 'GDPR-ART32',
    what: 'All AI interactions are encrypted in transit (TLS) and at rest (KMS). Access is logged with user identity.',
    why: 'GDPR Article 32 requires appropriate technical measures to ensure security of processing.',
    blockedExamples: ['Unencrypted connections', 'Requests without authenticated user identity'],
    allowedExamples: ['All HTTPS requests with valid authentication'],
    ruleConfig: { type: 'encryption', action: 'block', config: { requireTls: true, requireAuth: true } },
  },
  'GDPR-ART44': {
    controlId: 'GDPR-ART44',
    what: 'Requests containing EU personal data are blocked from being routed to AI providers outside EU regions unless adequate safeguards exist.',
    why: 'GDPR Article 44 restricts transfers of personal data to third countries without adequate protection.',
    blockedExamples: [
      'EU customer data sent to us-east-1 (US) Bedrock endpoint',
      'EU personal data routed to OpenAI US servers without SCCs',
    ],
    allowedExamples: [
      'EU data sent to eu-west-1 Bedrock endpoint',
      'Anonymized data sent to any region',
    ],
    ruleConfig: { type: 'region_restriction', action: 'block', config: { allowedRegions: ['eu-west-1', 'eu-central-1', 'eu-west-3'] } },
  },
  'GDPR-ART17': {
    controlId: 'GDPR-ART17',
    what: 'Requests involving identifiable personal data are tagged in audit logs to support right-to-erasure requests.',
    why: 'GDPR Article 17 right to erasure requires organizations to be able to identify and delete personal data on request.',
    blockedExamples: [],
    allowedExamples: ['All requests — personal data interactions are flagged for erasure tracking.'],
    ruleConfig: { type: 'audit_logging', action: 'allow', config: { tagPiiRequests: true } },
  },

  // ── HIPAA ──────────────────────────────────────────────────────────────────
  'HIPAA-164.312-A1': {
    controlId: 'HIPAA-164.312-A1',
    what: 'Prompts containing Protected Health Information (patient names, DOB, diagnosis, MRN, medications) are blocked from AI providers.',
    why: 'HIPAA Security Rule 164.312(a)(1) requires access controls to protect ePHI from unauthorized disclosure.',
    blockedExamples: [
      '"Patient John Smith, DOB 1975-03-15, diagnosed with Type 2 diabetes, prescribed Metformin"',
      '"MRN 12345678 — summarize this patient\'s treatment history"',
      '"The lab results for patient ID 9876 show elevated HbA1c"',
    ],
    allowedExamples: [
      '"Summarize this de-identified case study" (no PHI)',
      '"What are the treatment guidelines for Type 2 diabetes?" (general query)',
    ],
    ruleConfig: {
      type: 'pii_detection', action: 'block',
      config: { piiTypes: ['NAME', 'DATE_OF_BIRTH', 'MEDICAL_RECORD_NUMBER', 'DIAGNOSIS', 'MEDICATION'], action: 'block' },
    },
  },
  'HIPAA-164.312-B': {
    controlId: 'HIPAA-164.312-B',
    what: 'Every access to AI systems that could process PHI is logged with user identity, timestamp, and action taken.',
    why: 'HIPAA Security Rule 164.312(b) requires audit controls to record and examine activity in systems containing ePHI.',
    blockedExamples: [],
    allowedExamples: ['All requests are logged — this control enables auditing, not blocking.'],
    ruleConfig: { type: 'audit_logging', action: 'allow', config: { logLevel: 'full', includeUserIdentity: true } },
  },
  'HIPAA-164.312-E1': {
    controlId: 'HIPAA-164.312-E1',
    what: 'Only AI providers with a signed HIPAA Business Associate Agreement (BAA) are permitted for PHI processing.',
    why: 'HIPAA Security Rule 164.312(e)(1) requires encryption and integrity controls for ePHI in transit.',
    blockedExamples: [
      'Sending PHI to OpenAI without a signed BAA',
      'Using a non-HIPAA-compliant AI provider for clinical data',
    ],
    allowedExamples: [
      'Amazon Bedrock (AWS signs BAA)',
      'Azure OpenAI (Microsoft signs BAA)',
    ],
    ruleConfig: {
      type: 'model_restriction', action: 'block',
      config: { allowedProviders: ['bedrock'], requireBaa: true },
    },
  },
  'HIPAA-164.308-A3': {
    controlId: 'HIPAA-164.308-A3',
    what: 'Only users with authorized clinical roles may use AI features that could process PHI. Role enforcement is applied per request.',
    why: 'HIPAA Security Rule 164.308(a)(3) requires workforce access management — only authorized staff access ePHI.',
    blockedExamples: [
      'A billing clerk accessing clinical AI features',
      'An unauthenticated user querying patient data',
    ],
    allowedExamples: ['Authenticated clinician with role=clinical_staff accessing approved AI features'],
    ruleConfig: { type: 'access_control', action: 'block', config: { allowedRoles: ['clinical_staff', 'physician', 'admin'] } },
  },

  // ── ISO 42001 ──────────────────────────────────────────────────────────────
  'ISO42001-6.1': {
    controlId: 'ISO42001-6.1',
    what: 'Prompts are scored for risk based on content patterns. High-risk prompts are flagged for review.',
    why: 'ISO 42001 clause 6.1 requires organizations to identify and assess AI-related risks.',
    blockedExamples: [
      '"Here are our internal financial projections for Q4..." — flagged as high risk',
      '"The API key for our production system is..." — flagged',
    ],
    allowedExamples: ['"Write a summary of this public report" — low risk, passes'],
    ruleConfig: {
      type: 'data_classification', action: 'warn',
      config: { patterns: ['internal', 'confidential', 'secret', 'private key', 'api key'] },
    },
  },
  'ISO42001-8.4': {
    controlId: 'ISO42001-8.4',
    what: 'Only AI models that have been documented and approved in the model inventory may be used.',
    why: 'ISO 42001 clause 8.4 requires documentation of AI systems including their purpose, capabilities, and limitations.',
    blockedExamples: ['Requests to undocumented or unapproved AI models'],
    allowedExamples: ['Requests to models in the approved inventory'],
    ruleConfig: {
      type: 'model_restriction', action: 'block',
      config: { allowedModels: ['anthropic.claude-3-sonnet-20240229-v1:0', 'anthropic.claude-3-haiku-20240307-v1:0'] },
    },
  },
  'ISO42001-8.5': {
    controlId: 'ISO42001-8.5',
    what: 'Requests classified as high-risk (score > 75) are flagged and queued for human review before the response is returned.',
    why: 'ISO 42001 clause 8.5 requires human oversight mechanisms for high-risk AI decisions.',
    blockedExamples: [
      'High-risk prompt sent without human review flag',
    ],
    allowedExamples: ['Low and medium risk prompts proceed normally', 'High-risk prompts are flagged but not blocked'],
    ruleConfig: { type: 'data_classification', action: 'warn', config: { riskThreshold: 75, flagForReview: true } },
  },

  // ── PIPEDA ─────────────────────────────────────────────────────────────────
  'PIPEDA-P1': {
    controlId: 'PIPEDA-P1',
    what: 'All AI interactions are logged with the responsible user and organization for accountability purposes.',
    why: 'PIPEDA Principle 1 (Accountability) requires organizations to be accountable for personal information under their control.',
    blockedExamples: [],
    allowedExamples: ['All requests are logged — accountability is enforced through audit trails.'],
    ruleConfig: { type: 'audit_logging', action: 'allow', config: { logLevel: 'full' } },
  },
  'PIPEDA-P4': {
    controlId: 'PIPEDA-P4',
    what: 'Personal information in AI prompts is limited to what is necessary. Excess personal data is masked before reaching AI providers.',
    why: 'PIPEDA Principle 4 (Limiting Collection) requires that personal information be collected only for identified purposes.',
    blockedExamples: [
      '"Here is the full customer profile including SIN, address, and purchase history"',
    ],
    allowedExamples: ['"Classify this support ticket" (anonymized content)'],
    ruleConfig: { type: 'pii_detection', action: 'mask', config: {} },
  },
  'PIPEDA-P7': {
    controlId: 'PIPEDA-P7',
    what: 'Personal information in AI interactions is protected by encryption in transit and at rest, with access controls.',
    why: 'PIPEDA Principle 7 (Safeguards) requires security safeguards appropriate to the sensitivity of the information.',
    blockedExamples: ['Unencrypted connections', 'Unauthenticated access'],
    allowedExamples: ['All authenticated HTTPS requests'],
    ruleConfig: { type: 'encryption', action: 'block', config: { requireTls: true } },
  },
};
