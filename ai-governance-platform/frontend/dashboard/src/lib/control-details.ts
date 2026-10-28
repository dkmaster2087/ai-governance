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

  // ── EU AI Act ──────────────────────────────────────────────────────────────
  'EUAIA-ART9': {
    controlId: 'EUAIA-ART9',
    what: 'Continuous risk identification and scoring for all AI interactions. High-risk prompts flagged for review.',
    why: 'EU AI Act Article 9 requires a risk management system that identifies, evaluates, and mitigates risks throughout the AI system lifecycle.',
    blockedExamples: [],
    allowedExamples: ['All requests scored; high-risk flagged in audit log'],
    ruleConfig: { type: 'data_classification', action: 'warn', config: { patterns: ['password', 'secret key', 'api key'] } },
  },
  'EUAIA-ART12': {
    controlId: 'EUAIA-ART12',
    what: 'Every AI request automatically logged with input, output, decision, tokens, and latency for full traceability.',
    why: 'EU AI Act Article 12 mandates automatic logging to enable traceability of AI system operations.',
    blockedExamples: [],
    allowedExamples: ['All requests logged with full context'],
    ruleConfig: { type: 'audit_logging', action: 'allow', config: { logLevel: 'full' } },
  },
  'EUAIA-ART13': {
    controlId: 'EUAIA-ART13',
    what: 'Users are informed they are interacting with AI. Responses flagged as AI-generated.',
    why: 'EU AI Act Article 13 requires transparency — users must know they are interacting with an AI system.',
    blockedExamples: [],
    allowedExamples: ['All AI interactions carry disclosure metadata'],
    ruleConfig: { type: 'transparency', action: 'allow', config: { addDisclosure: true } },
  },
  'EUAIA-ART15': {
    controlId: 'EUAIA-ART15',
    what: 'Harmful content blocked. Rate limiting enforced to prevent abuse and ensure system robustness.',
    why: 'EU AI Act Article 15 requires appropriate accuracy, robustness, and cybersecurity measures.',
    blockedExamples: ['"How to hack into a system"', '"Create a phishing email"'],
    allowedExamples: ['"Summarize this document"', '"Help me write a report"'],
    ruleConfig: { type: 'keyword_block', action: 'block', config: { keywords: ['how to hack', 'exploit vulnerability', 'create malware'] } },
  },

};
