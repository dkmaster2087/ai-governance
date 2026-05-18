import { ResponseScanner } from '../services/response-scanner';

describe('ResponseScanner', () => {
  const scanner = new ResponseScanner();

  describe('scan', () => {
    it('returns no findings for clean content', () => {
      const result = scanner.scan('Hello, how can I help you today?');
      expect(result.findingsCount).toBe(0);
      expect(result.findings).toHaveLength(0);
      expect(result.maskedContent).toBe('Hello, how can I help you today?');
    });

    it('detects email addresses', () => {
      const result = scanner.scan('Contact john.doe@example.com for details');
      expect(result.findingsCount).toBe(1);
      expect(result.findings[0].type).toBe('email');
      expect(result.maskedContent).toContain('jo***@example.com');
      expect(result.maskedContent).not.toContain('john.doe@example.com');
    });

    it('detects phone numbers', () => {
      const result = scanner.scan('Call me at 555-123-4567');
      expect(result.findingsCount).toBe(1);
      expect(result.findings[0].type).toBe('phone');
      expect(result.maskedContent).toContain('[PHONE REDACTED]');
    });

    it('detects SSNs', () => {
      const result = scanner.scan('SSN: 123-45-6789');
      expect(result.findingsCount).toBe(1);
      expect(result.findings[0].type).toBe('ssn');
      expect(result.maskedContent).toContain('[SSN REDACTED]');
    });

    it('detects credit card numbers', () => {
      const result = scanner.scan('Card number is 4111111111111111 here');
      const ccFinding = result.findings.find((f) => f.type === 'credit_card');
      expect(ccFinding).toBeDefined();
      expect(result.maskedContent).not.toContain('4111111111111111');
    });

    it('detects API keys', () => {
      const result = scanner.scan('Use key sk-abc123def456ghi789jkl012mno345pqr678');
      expect(result.findingsCount).toBe(1);
      expect(result.findings[0].type).toBe('api_key');
      expect(result.maskedContent).not.toContain('sk-abc123def456ghi789jkl012mno345pqr678');
    });

    it('detects password patterns', () => {
      const result = scanner.scan('password: MyS3cr3tP@ss!');
      expect(result.findingsCount).toBe(1);
      expect(result.findings[0].type).toBe('password_pattern');
      expect(result.maskedContent).toContain('[REDACTED]');
    });

    it('detects multiple PII types in one response', () => {
      const content = 'Email: test@corp.com, Phone: 555-000-1234, SSN: 111-22-3333';
      const result = scanner.scan(content);
      expect(result.findingsCount).toBe(3);
      const types = result.findings.map((f) => f.type);
      expect(types).toContain('email');
      expect(types).toContain('phone');
      expect(types).toContain('ssn');
    });

    it('handles empty content', () => {
      const result = scanner.scan('');
      expect(result.scanned).toBe(true);
      expect(result.findingsCount).toBe(0);
    });

    it('does not store full PII values in findings', () => {
      const result = scanner.scan('Email: longusername@company.com');
      expect(result.findings[0].value).toContain('***');
      expect(result.findings[0].value.length).toBeLessThan('longusername@company.com'.length);
    });
  });

  describe('scanResponse', () => {
    it('returns response unchanged when no PII found', () => {
      const response = { requestId: 'r1', content: 'Hello world', inputTokens: 10, outputTokens: 5, latencyMs: 100, provider: 'openai' as any, modelId: 'gpt-4', finishReason: 'stop', timestamp: '2026-01-01' };
      const result = scanner.scanResponse(response, true);
      expect(result.content).toBe('Hello world');
      expect((result as any).piiFindings).toBeUndefined();
    });

    it('masks PII when maskEnabled is true', () => {
      const response = { requestId: 'r1', content: 'Contact admin@corp.com', inputTokens: 10, outputTokens: 5, latencyMs: 100, provider: 'openai' as any, modelId: 'gpt-4', finishReason: 'stop', timestamp: '2026-01-01' };
      const result = scanner.scanResponse(response, true);
      expect(result.content).not.toContain('admin@corp.com');
      expect((result as any).piiFindings).toHaveLength(1);
    });

    it('preserves original content when maskEnabled is false', () => {
      const response = { requestId: 'r1', content: 'Contact admin@corp.com', inputTokens: 10, outputTokens: 5, latencyMs: 100, provider: 'openai' as any, modelId: 'gpt-4', finishReason: 'stop', timestamp: '2026-01-01' };
      const result = scanner.scanResponse(response, false);
      expect(result.content).toBe('Contact admin@corp.com');
      expect((result as any).piiFindings).toHaveLength(1);
    });
  });
});
