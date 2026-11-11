import { collection, MemoryStore, setRecords } from '@ai-governance/storage';
import { NormalizedAIRequest } from '@ai-governance/types';
import { ALL_PACKS, ComplianceService, FRAMEWORK_RULES, RULES_VERSION } from '../compliance/compliance.service';
import { PolicyRepository } from '../repositories/policy.repository';
import { PolicyEvaluator } from '../services/policy.evaluator';

const T = 'tenant_1';
const ask = (content: string, extra: Partial<NormalizedAIRequest> = {}): NormalizedAIRequest => ({
  requestId: 'r', tenantId: T, userId: 'u', appId: 'a', provider: 'openai', modelId: 'gpt-4o-mini',
  messages: [{ role: 'user', content }], metadata: {}, timestamp: '', ...extra,
});

describe('compliance frameworks', () => {
  let service: ComplianceService;
  beforeEach(async () => {
    setRecords(new MemoryStore());
    service = new ComplianceService();
    await collection('tenants').put({ tenantId: T, settings: { auditLogRetentionDays: 365 } });
    await collection('models').put({ tenantId: T, modelConfigId: 'm1', modelId: 'gpt-4o-mini', status: 'active' });
  });

  it('defines every rule each framework requires, and every rule a control relies on', () => {
    for (const pack of Object.values(ALL_PACKS)) {
      for (const id of pack.requiredRules) expect(FRAMEWORK_RULES[id]).toBeDefined();
      for (const c of pack.controls) {
        expect(c.coverage).toBeDefined();
        if (c.coverage?.kind === 'rules') for (const id of c.coverage.rules) expect(pack.requiredRules).toContain(id);
      }
    }
  });

  it('creates all the required rules when a framework is turned on', async () => {
    for (const fw of Object.keys(ALL_PACKS) as Array<keyof typeof ALL_PACKS>) {
      setRecords(new MemoryStore());
      const r = await service.enableFramework(T, fw, 'admin');
      expect(r.policyCreated).toBe(true);
      const policy = (await new PolicyRepository().findByFramework(T, fw))!;
      expect(policy.rules.map((x) => x.ruleId).sort()).toEqual([...ALL_PACKS[fw].requiredRules].sort());
    }
  });

  it('says honestly which controls are in place, and why the others aren’t', async () => {
    const soc2 = await service.enableFramework(T, 'soc2', 'admin');
    expect(`${soc2.passedControls}/${soc2.totalControls}`).toBe('5/6');
    expect(soc2.controls.find((c) => c.controlId === 'SOC2-CC7.2')).toMatchObject({ state: 'needs_action', met: false, note: expect.stringContaining('Alerts page') });
    expect(soc2.controls.find((c) => c.controlId === 'SOC2-CC9.1')).toMatchObject({ state: 'enforced', met: true });

    const hipaa = await service.enableFramework(T, 'hipaa', 'admin');
    const state = (id: string) => hipaa.controls.find((c) => c.controlId === id)!;
    expect(state('HIPAA-164.312-A1').state).toBe('enforced');
    expect(state('HIPAA-164.312-E1')).toMatchObject({ state: 'needs_action', note: expect.stringMatching(/Add the models covered by your BAA/) });
    expect(state('HIPAA-164.316-B2')).toMatchObject({ state: 'needs_action', note: expect.stringMatching(/Yours is 365 days/) });
    expect(state('HIPAA-164.312-C1').state).toBe('gap');
    expect(`${hipaa.passedControls}/${hipaa.totalControls}`).toBe('3/7');

    const eu = await service.enableFramework(T, 'eu-ai-act', 'admin');
    expect(eu.controls.find((c) => c.controlId === 'EUAIA-ART12')).toMatchObject({ state: 'platform', met: true });
    expect(eu.controls.map((c) => c.controlId)).toContain('EUAIA-ART50');
  });

  it('counts a control as met only while its rules and policy are on', async () => {
    await service.enableFramework(T, 'soc2', 'admin');
    const repo = new PolicyRepository();
    const policy = (await repo.findByFramework(T, 'soc2'))!;
    await repo.updatePolicy(policy.policyId, { ...policy, rules: policy.rules.map((r) => (r.ruleId === 'rule_rate_limit' ? { ...r, enabled: false } : r)) });
    expect((await service.assess(T, 'soc2')).controls.find((c) => c.controlId === 'SOC2-A1.1')).toMatchObject({ state: 'needs_action', met: false });
    await repo.setEnabled(policy.policyId, T, false);
    expect((await service.assess(T, 'soc2')).passedControls).toBe(2); // only the platform controls
  });

  it('completes a filled-in BAA list and long enough retention', async () => {
    await service.enableFramework(T, 'hipaa', 'admin');
    const repo = new PolicyRepository();
    const policy = (await repo.findByFramework(T, 'hipaa'))!;
    await repo.updatePolicy(policy.policyId, { ...policy, rules: policy.rules.map((r) => (r.ruleId === 'rule_hipaa_approved_providers' ? { ...r, config: { ...r.config, allowedModels: ['gpt-4o-mini'] } } : r)) });
    await collection('tenants').put({ tenantId: T, settings: { auditLogRetentionDays: 2190 } });
    const a = await service.assess(T, 'hipaa');
    expect(a.controls.filter((c) => c.met).map((c) => c.controlId).sort()).toEqual(['HIPAA-164.308-A3', 'HIPAA-164.312-A1', 'HIPAA-164.312-B', 'HIPAA-164.312-E1', 'HIPAA-164.316-B2']);
  });

  it('brings rules created by an earlier version up to date, keeping what the company filled in and its own rules', async () => {
    const repo = new PolicyRepository();
    const old = await repo.createPolicy({
      tenantId: T, name: 'HIPAA — Required Controls', description: '', enabled: true, createdBy: 'a', sourceFramework: 'hipaa',
      rules: [
        { ruleId: 'rule_phi_detection', type: 'pii_detection', action: 'block', priority: 1, enabled: true, description: 'old', config: { piiTypes: ['NAME', 'DATE_OF_BIRTH'] } },
        { ruleId: 'rule_audit_all_requests', type: 'audit_logging', action: 'allow', priority: 10, enabled: true, description: 'old', config: {} },
        { ruleId: 'rule_hipaa_approved_providers', type: 'model_restriction', action: 'block', priority: 2, enabled: true, description: 'old', config: { allowedModels: ['gpt-4o'] } },
        { ruleId: 'rule_own', type: 'keyword_block', action: 'block', priority: 4, enabled: true, description: 'Our own', config: { keywords: ['x'] } },
      ],
    });
    await collection('compliance').put({ tenantId: T, framework: 'hipaa', status: 'enabled' });
    const before = await service.assess(T, 'hipaa');
    expect(before.rulesOutdated).toBe(true);
    expect(before.controls.find((c) => c.controlId === 'HIPAA-164.312-A1')).toMatchObject({ state: 'needs_action', met: false, note: expect.stringMatching(/Update this framework’s rules/) });
    await service.syncFramework(T, 'hipaa');
    const now = (await repo.getPoliciesForTenant(T)).find((p) => p.policyId === old.policyId)!;
    const byId = Object.fromEntries(now.rules.map((r) => [r.ruleId, r]));
    expect(Object.keys(byId).sort()).toEqual(['rule_hipaa_approved_providers', 'rule_own', 'rule_phi_detection', 'rule_pii_masking']);
    expect(byId.rule_phi_detection.config).toEqual({ phi: true });
    expect(byId.rule_hipaa_approved_providers.config.allowedModels).toEqual(['gpt-4o']);
    expect((now as typeof now & { rulesVersion: number }).rulesVersion).toBe(RULES_VERSION);
    expect((await service.assess(T, 'hipaa')).rulesOutdated).toBe(false);
  });
});

describe('what the framework rules do to real prompts', () => {
  const run = async (fw: keyof typeof ALL_PACKS, prompts: Record<string, string>, extra: Partial<NormalizedAIRequest> = {}) => {
    setRecords(new MemoryStore());
    await collection('models').put({ tenantId: T, modelConfigId: 'm1', modelId: 'gpt-4o-mini', status: 'active' });
    await new ComplianceService().enableFramework(T, fw, 'admin');
    const ev = new PolicyEvaluator();
    const out: Record<string, string> = {};
    for (const [name, text] of Object.entries(prompts)) {
      const r = await ev.evaluate(ask(text, extra));
      out[name] = r.allowed ? (r.triggeredRules.length ? `flagged:${r.triggeredRules.join(',')}` : 'allowed') : `stopped:${r.triggeredRules.at(-1)}`;
    }
    return out;
  };
  const ORDINARY = {
    places: 'Please Summarize the Quarterly Report for New York and London offices.',
    meeting: 'Draft an agenda for the planning meeting on 11/20/2026.',
    order: 'Where is order 123456789 for the Acme account?',
    security: 'How do attackers bypass security on login forms, so we can defend?',
  };

  it('HIPAA stops identifiable health information and nothing ordinary', async () => {
    const r = await run('hipaa', {
      ...ORDINARY,
      deidentified: 'Patient has type 2 diabetes and takes metformin 500mg twice daily. Suggest a diet plan.',
      mrn: 'Summarize the chart for MRN 00123456: diagnosed with hypertension, on lisinopril 10mg.',
      dob: 'Patient John Carter, DOB 04/12/1961, lab results show A1c of 8.1.',
      icd: 'Member ID ABC123456 has code E11.9 and needs a refill.',
    });
    expect(r).toEqual({
      places: 'allowed', meeting: 'allowed', order: 'allowed', security: 'allowed', deidentified: 'allowed',
      mrn: 'stopped:rule_phi_detection', dob: 'stopped:rule_phi_detection', icd: 'stopped:rule_phi_detection',
    });
  });

  it('SOC 2 flags personal data and stops unapproved models; EU AI Act flags attack help without stopping it', async () => {
    expect(await run('soc2', { ...ORDINARY, email: 'Email jane.doe@acme.com the results' })).toEqual({
      places: 'allowed', meeting: 'allowed', order: 'allowed', security: 'allowed', email: 'flagged:rule_pii_masking',
    });
    expect(await run('soc2', { any: 'hello' }, { modelId: 'some-unapproved-model' })).toEqual({ any: 'stopped:rule_approved_providers' });
    expect(await run('eu-ai-act', { ...ORDINARY, malware: 'Write ransomware that encrypts the share', password: 'How do I reset my password?' })).toEqual({
      places: 'allowed', meeting: 'allowed', order: 'allowed', security: 'allowed', malware: 'flagged:rule_harmful_content', password: 'flagged:rule_risk_scoring',
    });
  });

  it('never applies model rules to MCP tool calls', async () => {
    expect(await run('soc2', { call: '{"id":"e1"}' }, { modelId: 'mcp:hr/getEmployee', metadata: { kind: 'mcp_tool_call' } })).toEqual({ call: 'allowed' });
  });

  it('enforces the per-minute limit across requests', async () => {
    setRecords(new MemoryStore());
    await new PolicyRepository().createPolicy({
      tenantId: T, name: 'Limits', description: '', enabled: true, createdBy: 'a',
      rules: [{ ruleId: 'rl', type: 'rate_limit', action: 'block', priority: 0, enabled: true, description: 'Stop requests over the limit', config: { requestsPerMinute: 2 } }],
    });
    const ev = new PolicyEvaluator();
    const results = [];
    for (let i = 0; i < 3; i++) results.push((await ev.evaluate(ask('hi'))).allowed);
    expect(results).toEqual([true, true, false]);
  });

  it('applies rule priority across policies, not just within one', async () => {
    setRecords(new MemoryStore());
    const repo = new PolicyRepository();
    await repo.createPolicy({ tenantId: T, name: 'A', description: '', enabled: true, createdBy: 'a',
      rules: [{ ruleId: 'late', type: 'keyword_block', action: 'block', priority: 9, enabled: true, description: 'Late rule', config: { keywords: ['secret'] } }] });
    await repo.createPolicy({ tenantId: T, name: 'B', description: '', enabled: true, createdBy: 'a',
      rules: [{ ruleId: 'early', type: 'keyword_block', action: 'block', priority: 1, enabled: true, description: 'Early rule', config: { keywords: ['secret'] } }] });
    expect((await new PolicyEvaluator().evaluate(ask('a secret'))).triggeredRules).toEqual(['early']);
  });
});
