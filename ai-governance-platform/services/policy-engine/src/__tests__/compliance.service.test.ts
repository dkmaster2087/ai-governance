import { ComplianceService, ALL_PACKS } from '../compliance/compliance.service';
import { PolicyRepository } from '../repositories/policy.repository';

jest.mock('../repositories/policy.repository');
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: jest.fn().mockResolvedValue({ Items: [] }) }) },
  QueryCommand: jest.fn(),
  PutCommand: jest.fn(),
  DeleteCommand: jest.fn(),
}));

const MockRepo = PolicyRepository as jest.MockedClass<typeof PolicyRepository>;

describe('ComplianceService', () => {
  let service: ComplianceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ComplianceService();
  });

  it('returns all 6 compliance packs', () => {
    const packs = service.getAllPacks();
    expect(packs).toHaveLength(6);
  });

  it('includes all expected frameworks', () => {
    const frameworks = service.getAllPacks().map((p) => p.framework);
    expect(frameworks).toContain('nist-ai-rmf');
    expect(frameworks).toContain('soc2');
    expect(frameworks).toContain('gdpr');
    expect(frameworks).toContain('hipaa');
    expect(frameworks).toContain('iso-42001');
    expect(frameworks).toContain('pipeda');
  });

  it('each pack has controls and required rules', () => {
    service.getAllPacks().forEach((pack) => {
      expect(pack.controls.length).toBeGreaterThan(0);
      expect(pack.requiredRules.length).toBeGreaterThan(0);
      expect(pack.name).toBeTruthy();
      expect(pack.description).toBeTruthy();
    });
  });

  it('getPack returns correct pack', () => {
    const pack = service.getPack('gdpr');
    expect(pack.framework).toBe('gdpr');
    expect(pack.name).toContain('GDPR');
  });

  it('assessCompliance returns partial when some rules present', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue([
      {
        policyId: 'p1', tenantId: 't1', name: 'Test', description: '', enabled: true,
        createdAt: '', updatedAt: '', createdBy: 'admin',
        rules: [{ ruleId: 'rule_pii_masking', type: 'pii_detection', action: 'mask', priority: 1, enabled: true, description: '', config: {} }],
      },
    ]);

    const result = await service.assessCompliance('tenant_1', 'soc2');
    expect(result.status).toBe('partial');
    expect(result.passedControls).toBeGreaterThan(0);
    expect(result.totalControls).toBe(ALL_PACKS['soc2'].controls.length);
  });

  it('assessCompliance returns disabled when no rules present', async () => {
    MockRepo.prototype.getPoliciesForTenant.mockResolvedValue([]);
    const result = await service.assessCompliance('tenant_1', 'nist-ai-rmf');
    expect(result.status).toBe('disabled');
    expect(result.passedControls).toBe(0);
  });
});
