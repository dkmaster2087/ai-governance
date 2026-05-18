import { AlertingService } from '../services/alerting.service';

describe('AlertingService', () => {
  const service = new AlertingService();

  describe('getDefaultRules', () => {
    it('returns 6 default alert rules', () => {
      const rules = service.getDefaultRules('tenant_test', 'https://hooks.example.com/alerts');
      expect(rules).toHaveLength(6);
    });

    it('sets correct tenant and destination on all rules', () => {
      const rules = service.getDefaultRules('tenant_demo', 'https://my-webhook.com');
      for (const rule of rules) {
        expect(rule.tenantId).toBe('tenant_demo');
        expect(rule.destination).toBe('https://my-webhook.com');
        expect(rule.enabled).toBe(true);
        expect(rule.triggerCount).toBe(0);
      }
    });

    it('includes budget threshold rules', () => {
      const rules = service.getDefaultRules('tenant_test', 'https://x.com');
      const budgetRules = rules.filter((r) => r.type === 'budget_threshold');
      expect(budgetRules).toHaveLength(2);
      expect(budgetRules[0].config.thresholdPercent).toBe(80);
      expect(budgetRules[1].config.thresholdPercent).toBe(100);
    });

    it('includes policy violation spike rule', () => {
      const rules = service.getDefaultRules('tenant_test', 'https://x.com');
      const pvRule = rules.find((r) => r.type === 'policy_violation_spike');
      expect(pvRule).toBeDefined();
      expect(pvRule!.config.threshold).toBe(10);
      expect(pvRule!.config.windowMinutes).toBe(60);
    });

    it('includes license expiry rule', () => {
      const rules = service.getDefaultRules('tenant_test', 'https://x.com');
      const leRule = rules.find((r) => r.type === 'license_expiry');
      expect(leRule).toBeDefined();
      expect(leRule!.config.daysBeforeExpiry).toBe(30);
    });

    it('includes shadow AI activity rule', () => {
      const rules = service.getDefaultRules('tenant_test', 'https://x.com');
      const saRule = rules.find((r) => r.type === 'shadow_ai_activity');
      expect(saRule).toBeDefined();
      expect(saRule!.config.minAttempts).toBe(5);
    });

    it('includes PII leakage rule', () => {
      const rules = service.getDefaultRules('tenant_test', 'https://x.com');
      const piiRule = rules.find((r) => r.type === 'pii_leakage');
      expect(piiRule).toBeDefined();
      expect(piiRule!.severity).toBe('critical');
    });

    it('generates unique rule IDs', () => {
      const rules = service.getDefaultRules('tenant_test', 'https://x.com');
      const ids = rules.map((r) => r.ruleId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
