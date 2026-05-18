import { NormalizedAIResponse } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('gateway:response-scanner');

export interface ScanFinding {
  type: string;
  value: string;
  masked: string;
  position: number;
}

export interface ResponseScanResult {
  scanned: boolean;
  findingsCount: number;
  findings: ScanFinding[];
  maskedContent: string;
  originalContent: string;
}

// PII patterns for response scanning
const PII_PATTERNS: { type: string; regex: RegExp; mask: (match: string) => string }[] = [
  {
    type: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    mask: (m) => m.replace(/(.{2}).*(@.*)/, '$1***$2'),
  },
  {
    type: 'phone',
    regex: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
    mask: () => '[PHONE REDACTED]',
  },
  {
    type: 'ssn',
    regex: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    mask: () => '[SSN REDACTED]',
  },
  {
    type: 'credit_card',
    regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    mask: (m) => m.slice(0, 4) + ' **** **** ' + m.slice(-4),
  },
  {
    type: 'ip_address',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    mask: () => '[IP REDACTED]',
  },
  {
    type: 'api_key',
    regex: /\b(?:sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]{36})\b/g,
    mask: (m) => m.slice(0, 6) + '...' + m.slice(-4),
  },
  {
    type: 'private_key',
    regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    mask: () => '[PRIVATE KEY REDACTED]',
  },
  {
    type: 'password_pattern',
    regex: /(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{4,}['"]?/gi,
    mask: (m) => m.replace(/[:=]\s*['"]?.*['"]?/, ': [REDACTED]'),
  },
];

export class ResponseScanner {
  /**
   * Scan AI response content for PII and sensitive data.
   * Returns findings and optionally masked content.
   */
  scan(content: string): ResponseScanResult {
    if (!content || content.length === 0) {
      return { scanned: true, findingsCount: 0, findings: [], maskedContent: content, originalContent: content };
    }

    const findings: ScanFinding[] = [];
    let maskedContent = content;

    for (const pattern of PII_PATTERNS) {
      const matches = content.matchAll(pattern.regex);
      for (const match of matches) {
        const value = match[0];
        const masked = pattern.mask(value);
        findings.push({
          type: pattern.type,
          value: value.slice(0, 4) + '***', // Don't store full PII in findings
          masked,
          position: match.index || 0,
        });
        maskedContent = maskedContent.replace(value, masked);
      }
    }

    if (findings.length > 0) {
      logger.info('Response PII detected', { findingsCount: findings.length, types: [...new Set(findings.map((f) => f.type))] });
    }

    return {
      scanned: true,
      findingsCount: findings.length,
      findings,
      maskedContent,
      originalContent: content,
    };
  }

  /**
   * Scan and mask a NormalizedAIResponse in place.
   * Returns the response with content masked if PII found.
   */
  scanResponse(response: NormalizedAIResponse, maskEnabled: boolean): NormalizedAIResponse & { piiFindings?: ScanFinding[] } {
    if (!response.content) return response;

    const result = this.scan(response.content);

    if (result.findingsCount === 0) return response;

    return {
      ...response,
      content: maskEnabled ? result.maskedContent : response.content,
      piiFindings: result.findings,
    };
  }
}
