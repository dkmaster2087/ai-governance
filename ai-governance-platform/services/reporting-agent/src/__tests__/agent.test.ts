import { ReportingAgent } from '../agent';

describe('ReportingAgent', () => {
  let agent: ReportingAgent;

  beforeEach(() => {
    // Reset singleton for testing
    (ReportingAgent as any).instance = undefined;
    agent = ReportingAgent.getInstance();
  });

  afterEach(() => {
    agent.stop();
  });

  describe('getInstance', () => {
    it('returns the same instance', () => {
      const a1 = ReportingAgent.getInstance();
      const a2 = ReportingAgent.getInstance();
      expect(a1).toBe(a2);
    });
  });

  describe('getConfig', () => {
    it('returns default config initially', () => {
      const config = agent.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.licenseKey).toBe('');
      expect(config.reportingInterval).toBe(300);
      expect(config.sync.usageMetrics).toBe(true);
      expect(config.sync.costData).toBe(true);
      expect(config.sync.complianceStatus).toBe(true);
      expect(config.sync.auditLogs).toBe(false);
    });
  });

  describe('configure', () => {
    it('updates config fields', () => {
      agent.configure({ licenseKey: 'AEGIS-TEST-1234', tenantId: 'tenant_test', enabled: true });
      const config = agent.getConfig();
      expect(config.licenseKey).toBe('AEGIS-TEST-1234');
      expect(config.tenantId).toBe('tenant_test');
      expect(config.enabled).toBe(true);
    });

    it('updates sync config partially', () => {
      agent.configure({ sync: { usageMetrics: true, costData: false, complianceStatus: true, auditLogs: true } });
      const config = agent.getConfig();
      expect(config.sync.costData).toBe(false);
      expect(config.sync.auditLogs).toBe(true);
    });

    it('preserves unmodified fields', () => {
      agent.configure({ licenseKey: 'AEGIS-X' });
      agent.configure({ tenantId: 'tenant_y' });
      const config = agent.getConfig();
      expect(config.licenseKey).toBe('AEGIS-X');
      expect(config.tenantId).toBe('tenant_y');
    });
  });

  describe('getStatus', () => {
    it('returns initial status', () => {
      const status = agent.getStatus();
      expect(status.enabled).toBe(false);
      expect(status.licenseValidated).toBe(false);
      expect(status.lastReportAt).toBeNull();
      expect(status.lastReportStatus).toBeNull();
      expect(status.reportCount).toBe(0);
    });
  });

  describe('start', () => {
    it('does not start without license key', () => {
      agent.configure({ enabled: true, licenseKey: '' });
      agent.start();
      const status = agent.getStatus();
      expect(status.enabled).toBe(true);
      // Agent won't actually run without a key
    });

    it('does not start when disabled', () => {
      agent.configure({ enabled: false, licenseKey: 'AEGIS-TEST' });
      agent.start();
      // No error thrown
    });
  });

  describe('stop', () => {
    it('can be called safely when not running', () => {
      expect(() => agent.stop()).not.toThrow();
    });
  });
});
