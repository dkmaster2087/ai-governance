export type ScanStatus = 'clean' | 'flagged' | 'blocked' | 'error';
export type ContentType = 'image' | 'document' | 'spreadsheet' | 'text';
export type ScanRiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface FileUploadMeta {
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  contentType: ContentType;
  s3Key: string;           // Temp S3 key — deleted after scan
  uploadedAt: string;
}

export interface PIIFinding {
  type: string;            // e.g. EMAIL, PHONE, SSN, CREDIT_CARD, NAME
  score: number;           // Confidence 0-1
  beginOffset: number;
  endOffset: number;
  maskedValue: string;
}

export interface ModerationLabel {
  name: string;            // e.g. 'Explicit Nudity', 'Violence', 'Hate Speech'
  confidence: number;
  parentName?: string;
}

export interface TextExtractionResult {
  extractedText: string;
  pageCount?: number;
  confidence: number;
  method: 'textract' | 'direct';
}

export interface ImageScanResult {
  moderationLabels: ModerationLabel[];
  detectedText?: string;
  containsPII: boolean;
  piiFindings: PIIFinding[];
  riskLevel: ScanRiskLevel;
}

export interface DocumentScanResult {
  extractedText: string;
  pageCount: number;
  containsPII: boolean;
  piiFindings: PIIFinding[];
  sensitiveDataTypes: string[];
  riskLevel: ScanRiskLevel;
}

export interface ContentScanResult {
  scanId: string;
  fileId: string;
  requestId: string;
  tenantId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: ScanStatus;
  riskLevel: ScanRiskLevel;
  riskScore: number;           // 0-100
  contentType: ContentType;
  imageScan?: ImageScanResult;
  documentScan?: DocumentScanResult;
  extractedText?: string;      // Text extracted and sent to AI (after masking)
  blockedReasons: string[];
  piiDetected: boolean;
  piiTypes: string[];
  scannedAt: string;
  scanDurationMs: number;
}

export interface MultimodalAIRequest {
  requestId: string;
  tenantId: string;
  userId: string;
  appId: string;
  modelId: string;
  textPrompt: string;
  attachments: FileUploadMeta[];
  scanResults: ContentScanResult[];
  timestamp: string;
}
