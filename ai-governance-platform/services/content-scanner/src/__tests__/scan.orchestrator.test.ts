import { ScanOrchestrator } from '../services/scan.orchestrator';
import { ImageScanner } from '../services/image.scanner';
import { DocumentScanner } from '../services/document.scanner';

jest.mock('../services/image.scanner');
jest.mock('../services/document.scanner');

const MockImageScanner = ImageScanner as jest.MockedClass<typeof ImageScanner>;
const MockDocumentScanner = DocumentScanner as jest.MockedClass<typeof DocumentScanner>;

const baseInput = {
  fileId: 'file_1',
  fileName: 'test.png',
  mimeType: 'image/png',
  buffer: Buffer.from('fake-image-data'),
  tenantId: 'tenant_demo',
  requestId: 'req_1',
  userId: 'user_1',
};

describe('ScanOrchestrator', () => {
  let orchestrator: ScanOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new ScanOrchestrator();
  });

  describe('image scanning', () => {
    it('returns clean status for safe image', async () => {
      MockImageScanner.prototype.scan.mockResolvedValue({
        moderationLabels: [],
        containsPII: false,
        piiFindings: [],
        riskLevel: 'none',
      });
      MockImageScanner.prototype.isBlockLabel.mockReturnValue(false);

      const result = await orchestrator.scan(baseInput);
      expect(result.status).toBe('clean');
      expect(result.riskLevel).toBe('none');
      expect(result.piiDetected).toBe(false);
    });

    it('blocks image with critical moderation label', async () => {
      MockImageScanner.prototype.scan.mockResolvedValue({
        moderationLabels: [{ name: 'Explicit Nudity', confidence: 95, parentName: 'Explicit Nudity' }],
        containsPII: false,
        piiFindings: [],
        riskLevel: 'critical',
      });
      MockImageScanner.prototype.isBlockLabel.mockReturnValue(true);

      const result = await orchestrator.scan(baseInput);
      expect(result.status).toBe('blocked');
      expect(result.blockedReasons.length).toBeGreaterThan(0);
      expect(result.blockedReasons[0]).toContain('Explicit Nudity');
    });

    it('flags image with PII in detected text', async () => {
      MockImageScanner.prototype.scan.mockResolvedValue({
        moderationLabels: [],
        detectedText: 'Email: user@example.com',
        containsPII: true,
        piiFindings: [{ type: 'EMAIL', score: 0.99, beginOffset: 7, endOffset: 23, maskedValue: '[EMAIL]' }],
        riskLevel: 'medium',
      });
      MockImageScanner.prototype.isBlockLabel.mockReturnValue(false);

      const result = await orchestrator.scan(baseInput);
      expect(result.status).toBe('flagged');
      expect(result.piiDetected).toBe(true);
      expect(result.piiTypes).toContain('EMAIL');
    });

    it('includes scan duration', async () => {
      MockImageScanner.prototype.scan.mockResolvedValue({
        moderationLabels: [], containsPII: false, piiFindings: [], riskLevel: 'none',
      });
      MockImageScanner.prototype.isBlockLabel.mockReturnValue(false);

      const result = await orchestrator.scan(baseInput);
      expect(result.scanDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('document scanning', () => {
    const docInput = { ...baseInput, fileName: 'report.pdf', mimeType: 'application/pdf' };

    it('returns clean for document with no sensitive data', async () => {
      MockDocumentScanner.prototype.scan.mockResolvedValue({
        extractedText: 'This is a safe document about AI governance.',
        pageCount: 2,
        containsPII: false,
        piiFindings: [],
        sensitiveDataTypes: [],
        riskLevel: 'none',
      });

      const result = await orchestrator.scan(docInput);
      expect(result.status).toBe('clean');
      expect(result.contentType).toBe('document');
    });

    it('flags document with PII', async () => {
      MockDocumentScanner.prototype.scan.mockResolvedValue({
        extractedText: 'Customer [EMAIL] has SSN [SSN]',
        pageCount: 1,
        containsPII: true,
        piiFindings: [
          { type: 'EMAIL', score: 0.99, beginOffset: 0, endOffset: 5, maskedValue: '[EMAIL]' },
          { type: 'SSN', score: 0.98, beginOffset: 10, endOffset: 15, maskedValue: '[SSN]' },
        ],
        sensitiveDataTypes: ['EMAIL', 'SSN'],
        riskLevel: 'high',
      });

      const result = await orchestrator.scan(docInput);
      expect(result.status).toBe('flagged');
      expect(result.piiTypes).toContain('EMAIL');
      expect(result.piiTypes).toContain('SSN');
    });

    it('blocks document with AWS credentials', async () => {
      MockDocumentScanner.prototype.scan.mockResolvedValue({
        extractedText: 'AWS key: [AWS_ACCESS_KEY]',
        pageCount: 1,
        containsPII: true,
        piiFindings: [],
        sensitiveDataTypes: ['AWS_ACCESS_KEY', 'AWS_SECRET_KEY'],
        riskLevel: 'critical',
      });

      const result = await orchestrator.scan(docInput);
      expect(result.status).toBe('blocked');
      expect(result.riskScore).toBe(100);
    });
  });

  describe('error handling', () => {
    it('returns error status when scanner throws', async () => {
      MockImageScanner.prototype.scan.mockRejectedValue(new Error('Rekognition unavailable'));

      const result = await orchestrator.scan(baseInput);
      expect(result.status).toBe('error');
      expect(result.blockedReasons[0]).toContain('Scan error');
    });
  });
});
