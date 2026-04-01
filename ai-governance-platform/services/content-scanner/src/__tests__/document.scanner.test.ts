import { DocumentScanner } from '../services/document.scanner';

// Mock AWS clients
jest.mock('@aws-sdk/client-textract', () => ({
  TextractClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      Blocks: [
        { BlockType: 'LINE', Text: 'Hello world', Page: 1 },
        { BlockType: 'LINE', Text: 'Contact us at admin@example.com', Page: 1 },
      ],
    }),
  })),
  DetectDocumentTextCommand: jest.fn(),
  AnalyzeDocumentCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-comprehend', () => ({
  ComprehendClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      Entities: [
        { Type: 'EMAIL', Score: 0.99, BeginOffset: 14, EndOffset: 31 },
      ],
    }),
  })),
  DetectPiiEntitiesCommand: jest.fn(),
}));

describe('DocumentScanner', () => {
  let scanner: DocumentScanner;

  beforeEach(() => {
    scanner = new DocumentScanner();
  });

  it('extracts plain text directly without Textract', async () => {
    const text = 'This is a plain text document with no sensitive data.';
    const result = await scanner.scan(Buffer.from(text), 'text/plain');
    expect(result.extractedText).toContain('plain text document');
    expect(result.pageCount).toBe(1);
  });

  it('detects AWS access key pattern', async () => {
    const text = 'My AWS key is AKIAIOSFODNN7EXAMPLE and secret is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const result = await scanner.scan(Buffer.from(text), 'text/plain');
    expect(result.sensitiveDataTypes).toContain('AWS_ACCESS_KEY');
    expect(result.riskLevel).toBe('critical');
  });

  it('detects private key pattern', async () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...';
    const result = await scanner.scan(Buffer.from(text), 'text/plain');
    expect(result.sensitiveDataTypes).toContain('PRIVATE_KEY');
  });

  it('detects connection string pattern', async () => {
    const text = 'DB_URL=postgresql://user:password@localhost:5432/mydb';
    const result = await scanner.scan(Buffer.from(text), 'text/plain');
    expect(result.sensitiveDataTypes).toContain('CONNECTION_STRING');
  });

  it('returns masked text (not raw PII)', async () => {
    const text = 'Call me at 416-555-1234 or email user@test.com';
    const result = await scanner.scan(Buffer.from(text), 'text/plain');
    expect(result.extractedText).not.toContain('416-555-1234');
    expect(result.extractedText).not.toContain('user@test.com');
  });

  it('returns none risk for clean document', async () => {
    const text = 'This document discusses AI governance best practices.';
    // Override Comprehend mock to return no entities
    const { ComprehendClient } = require('@aws-sdk/client-comprehend');
    ComprehendClient.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({ Entities: [] }),
    }));
    const cleanScanner = new DocumentScanner();
    const result = await cleanScanner.scan(Buffer.from(text), 'text/plain');
    expect(result.riskLevel).toBe('none');
    expect(result.containsPII).toBe(false);
  });
});
