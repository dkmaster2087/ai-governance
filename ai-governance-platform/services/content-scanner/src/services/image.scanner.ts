import {
  RekognitionClient,
  DetectModerationLabelsCommand,
  DetectTextCommand,
} from '@aws-sdk/client-rekognition';
import {
  ComprehendClient,
  DetectPiiEntitiesCommand,
} from '@aws-sdk/client-comprehend';
import { ImageScanResult, ModerationLabel, PIIFinding, ScanRiskLevel } from '@ai-governance/types';
import { maskPII, createLogger } from '@ai-governance/utils';

const logger = createLogger('content-scanner:image');

// Labels that trigger an immediate block
const BLOCK_LABELS = new Set([
  'Explicit Nudity', 'Nudity', 'Graphic Male Nudity', 'Graphic Female Nudity',
  'Sexual Activity', 'Illustrated Explicit Nudity',
  'Violence', 'Graphic Violence', 'Real Violence',
  'Weapons', 'Weapon Violence',
]);

// Labels that flag for review
const FLAG_LABELS = new Set([
  'Suggestive', 'Female Swimwear Or Underwear', 'Male Swimwear Or Underwear',
  'Partial Nudity', 'Barechested Male',
  'Visually Disturbing', 'Emaciated Bodies', 'Corpses',
  'Hate Symbols', 'Nazi Party', 'White Supremacy',
  'Drugs', 'Drug Products', 'Drug Use',
  'Tobacco', 'Tobacco Products',
  'Gambling',
]);

export class ImageScanner {
  private rekognition = new RekognitionClient({ region: process.env.AWS_REGION || 'us-east-1' });
  private comprehend = new ComprehendClient({ region: process.env.AWS_REGION || 'us-east-1' });

  async scan(buffer: Buffer, mimeType: string): Promise<ImageScanResult> {
    const imageBytes = new Uint8Array(buffer);

    const [moderationResult, textResult] = await Promise.allSettled([
      this.detectModeration(imageBytes),
      this.detectText(imageBytes),
    ]);

    const moderationLabels: ModerationLabel[] =
      moderationResult.status === 'fulfilled' ? moderationResult.value : [];

    const detectedText: string =
      textResult.status === 'fulfilled' ? textResult.value : '';

    // Scan any text found in the image for PII
    let piiFindings: PIIFinding[] = [];
    let containsPII = false;

    if (detectedText.length > 10) {
      const piiResult = await this.scanTextForPII(detectedText);
      piiFindings = piiResult.findings;
      containsPII = piiFindings.length > 0;
    }

    const riskLevel = this.calculateRiskLevel(moderationLabels, containsPII);

    logger.info('Image scan complete', {
      moderationLabels: moderationLabels.length,
      detectedTextLength: detectedText.length,
      piiFindings: piiFindings.length,
      riskLevel,
    });

    return {
      moderationLabels,
      detectedText: detectedText || undefined,
      containsPII,
      piiFindings,
      riskLevel,
    };
  }

  private async detectModeration(imageBytes: Uint8Array): Promise<ModerationLabel[]> {
    const result = await this.rekognition.send(
      new DetectModerationLabelsCommand({
        Image: { Bytes: imageBytes },
        MinConfidence: 60,
      })
    );

    return (result.ModerationLabels || []).map((label) => ({
      name: label.Name || '',
      confidence: label.Confidence || 0,
      parentName: label.ParentName || undefined,
    }));
  }

  private async detectText(imageBytes: Uint8Array): Promise<string> {
    const result = await this.rekognition.send(
      new DetectTextCommand({ Image: { Bytes: imageBytes } })
    );

    return (result.TextDetections || [])
      .filter((t) => t.Type === 'LINE')
      .map((t) => t.DetectedText || '')
      .join('\n');
  }

  private async scanTextForPII(text: string): Promise<{ findings: PIIFinding[]; maskedText: string }> {
    if (Buffer.byteLength(text) > 4900) {
      // Fallback to regex for large text
      const masked = maskPII(text);
      return { findings: [], maskedText: masked };
    }

    try {
      const result = await this.comprehend.send(
        new DetectPiiEntitiesCommand({ Text: text, LanguageCode: 'en' })
      );

      const findings: PIIFinding[] = (result.Entities || []).map((e) => ({
        type: e.Type || 'UNKNOWN',
        score: e.Score || 0,
        beginOffset: e.BeginOffset || 0,
        endOffset: e.EndOffset || 0,
        maskedValue: `[${e.Type}]`,
      }));

      return { findings, maskedText: maskPII(text) };
    } catch {
      return { findings: [], maskedText: maskPII(text) };
    }
  }

  private calculateRiskLevel(labels: ModerationLabel[], hasPII: boolean): ScanRiskLevel {
    const hasBlockLabel = labels.some((l) => BLOCK_LABELS.has(l.name) && l.confidence > 80);
    if (hasBlockLabel) return 'critical';

    const hasFlagLabel = labels.some((l) => FLAG_LABELS.has(l.name) && l.confidence > 70);
    if (hasFlagLabel) return hasPII ? 'high' : 'medium';

    if (hasPII) return 'medium';
    if (labels.length > 0) return 'low';
    return 'none';
  }

  isBlockLabel(labelName: string): boolean {
    return BLOCK_LABELS.has(labelName);
  }
}
