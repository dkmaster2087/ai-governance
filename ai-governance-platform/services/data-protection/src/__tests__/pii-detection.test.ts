import { PIIDetectionService } from '../services/pii-detection.service';
import { NormalizedAIRequest, NormalizedAIResponse } from '@ai-governance/types';

// Mock Comprehend so tests don't need AWS credentials
jest.mock('@aws-sdk/client-comprehend', () => ({
  ComprehendClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ Entities: [] }),
  })),
  DetectPiiEntitiesCommand: jest.fn(),
}));

const makeRequest = (content: string): NormalizedAIRequest => ({
  requestId: 'req_1',
  tenantId: 'tenant_1',
  userId: 'user_1',
  appId: 'app_1',
  provider: 'bedrock',
  modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
  messages: [{ role: 'user', content }],
  metadata: {},
  timestamp: new Date().toISOString(),
});

describe('PIIDetectionService', () => {
  let service: PIIDetectionService;

  beforeEach(() => {
    service = new PIIDetectionService();
  });

  it('masks email in user messages', async () => {
    const result = await service.protectRequest(makeRequest('Contact admin@company.com for help'));
    expect(result.messages[0].content).not.toContain('admin@company.com');
    expect(result.messages[0].content).toContain('[REDACTED]');
  });

  it('masks phone numbers in user messages', async () => {
    const result = await service.protectRequest(makeRequest('Call me at 416-555-9876'));
    expect(result.messages[0].content).not.toContain('416-555-9876');
  });

  it('does not modify assistant messages', async () => {
    const request: NormalizedAIRequest = {
      ...makeRequest(''),
      messages: [{ role: 'assistant', content: 'My email is bot@ai.com' }],
    };
    const result = await service.protectRequest(request);
    // Assistant messages are not masked on the way in
    expect(result.messages[0].content).toBe('My email is bot@ai.com');
  });

  it('filters PII from response content', async () => {
    const response: NormalizedAIResponse = {
      requestId: 'req_1',
      provider: 'bedrock',
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      content: 'The user email is test@example.com',
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 100,
      finishReason: 'stop',
      timestamp: new Date().toISOString(),
    };

    const result = await service.filterResponse(response);
    expect(result.content).not.toContain('test@example.com');
  });

  it('returns unchanged request when no PII present', async () => {
    const result = await service.protectRequest(makeRequest('What is the weather today?'));
    expect(result.messages[0].content).toBe('What is the weather today?');
  });
});
