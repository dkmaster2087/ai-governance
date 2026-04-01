import { ComplianceService, ALL_PACKS } from '../compliance/compliance.service';
import { PolicyRepository } from '../repositories/policy.repository';

jest.mock('../repositories/policy.repository');
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: jest.fn().mockResolvedValue({ Items: [] }) }) },
  QueryCommand: jest.fn(),
  PutCommand: jest.fn(),
  DeleteCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

const MockRepo = PolicyRepository as jest.MockedClass<typeof PolicyRepository>;

describe('ComplianceService', () => {
  let service: ComplianceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ComplianceService();
  });

  // ── Pack definitions ────────────────────────────────────────────────

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

  // ── Enable framework — 1:1 policy linking ──────────────────────────

  it('creates a new policy when no linked policy exists', async () => {
    MockRepo.prototype.findByFramework.mockResolvedValue(null);
    MockRepo.prototype.createPolicy.mockResolvedValue({
      policyId: 'new-policy-id',
      tenantId: 'tenant_1',
      name: 'GDPR — Required Controls',
      description: 'Auto-generated',
      enabled: true,
      rules: [],
      createdAt: '',
      updatedAt: '',
      createdBy: 'admin',
      sourceFramework: 'gdpr',
    } as any);

    const result = await service.enableFramework('tenant_1', 'gdpr', 'admin');

    expect(result.status).toBe('enabled');
    expect(result.policyCreated).toBe(true);
    expect(result.linkedPolicyId).toBe('new-policy-id');
    expect(MockRepo.prototype.createPolicy).toHaveBeenCalledTimes(1);
    expect(MockRepo.prototype.createPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ sourceFramework: 'gdpr', enabled: true })
    );
  });

  it('re-enables existing linked policy instead of creating duplicate', async () => {
    MockRepo.prototype.findByFramework.mockResolvedValue({
      policyId: 'existing-policy-id',
      tenantId: 'tenant_1',
      name: 'GDPR — Required Controls',
      description: '',
      enabled: false,
      rules: [],
      createdAt: '',
      updatedAt: '',
      createdBy: 'admin',
      sourceFramework: 'gdpr',
    } as any);

    const result = await service.enableFramework('tenant_1', 'gdpr', 'admin');

    expect(result.status).toBe('enabled');
    expect(result.policyCreated).toBe(false);
    expect(result.linkedPolicyId).toBe('existing-policy-id');
    expect(MockRepo.prototype.setEnabled).toHaveBeenCalledWith('existing-policy-id', 'tenant_1', true);
    expect(MockRepo.prototype.createPolicy).not.toHaveBeenCalled();
  });

  it('stores linkedPolicyId in compliance state', async () => {
    MockRepo.prototype.findByFramework.mockResolvedValue(null);
    MockRepo.prototype.createPolicy.mockResolvedValue({
      policyId: 'linked-id',
      tenantId: 'tenant_1',
      name: 'Test',
      description: '',
      enabled: true,
      rules: [],
      createdAt: '',
      updatedAt: '',
      createdBy: 'admin',
      sourceFramework: 'soc2',
    } as any);

    const result = await service.enableFramework('tenant_1', 'soc2', 'admin');
    expect(result.linkedPolicyId).toBe('linked-id');
  });

  // ── Disable framework — disables linked policy ─────────────────────

  it('disables linked policy when framework is disabled', async () => {
    MockRepo.prototype.findByFramework.mockResolvedValue({
      policyId: 'policy-to-disable',
      tenantId: 'tenant_1',
      name: 'HIPAA — Required Controls',
      description: '',
      enabled: true,
      rules: [],
      createdAt: '',
      updatedAt: '',
      createdBy: 'admin',
      sourceFramework: 'hipaa',
    } as any);

    const result = await service.disableFramework('tenant_1', 'hipaa');

    expect(result.disabledPolicyId).toBe('policy-to-disable');
    expect(MockRepo.prototype.setEnabled).toHaveBeenCalledWith('policy-to-disable', 'tenant_1', false);
  });

  it('returns no disabledPolicyId when no linked policy exists', async () => {
    MockRepo.prototype.findByFramework.mockResolvedValue(null);

    const result = await service.disableFramework('tenant_1', 'pipeda');

    expect(result.disabledPolicyId).toBeUndefined();
    expect(MockRepo.prototype.setEnabled).not.toHaveBeenCalled();
  });

  // ── Assess compliance ──────────────────────────────────────────────

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
