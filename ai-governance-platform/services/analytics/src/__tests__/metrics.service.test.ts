import { MetricsService } from '../services/metrics.service';

jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: jest.fn().mockResolvedValue({ Items: [] }) }) },
  QueryCommand: jest.fn(),
}));

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it('returns empty data array when no metrics found', async () => {
    const result = await service.getSummary('tenant_123', '7d');
    expect(result.tenantId).toBe('tenant_123');
    expect(result.data).toEqual([]);
  });

  it('returns cost breakdown structure', async () => {
    const result = await service.getCostBreakdown('tenant_123', '2026-01-01', '2026-01-31');
    expect(result).toHaveProperty('tenantId', 'tenant_123');
    expect(result).toHaveProperty('breakdown');
  });

  it('returns model distribution structure', async () => {
    const result = await service.getModelDistribution('tenant_123');
    expect(result).toHaveProperty('tenantId', 'tenant_123');
    expect(result).toHaveProperty('distribution');
  });

  it('returns violations structure', async () => {
    const result = await service.getViolations('tenant_123');
    expect(result).toHaveProperty('tenantId', 'tenant_123');
    expect(result).toHaveProperty('violations');
  });
});
