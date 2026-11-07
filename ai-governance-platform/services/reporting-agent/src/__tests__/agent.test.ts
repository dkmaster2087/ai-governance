import http from 'http';
import { AddressInfo } from 'net';
import { INTERNAL_HEADER, verifyInternal } from '@ai-governance/utils';
import { ReportingAgent, configFromEnv } from '../agent';

const KEY = 'k'.repeat(40);

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
      agent.configure({ licenseKey: 'PBL-TEST-1234', tenantId: 'tenant_test', enabled: true });
      const config = agent.getConfig();
      expect(config.licenseKey).toBe('PBL-TEST-1234');
      expect(config.tenantId).toBe('tenant_test');
      expect(config.enabled).toBe(true);
    });

    it('updates sync config partially', () => {
      agent.configure({ sync: { usageMetrics: true, costData: false, complianceStatus: true, auditLogs: true } });
      const config = agent.getConfig();
      expect(config.sync.costData).toBe(false);
      expect(config.sync.auditLogs).toBe(false);
    });

    it('preserves unmodified fields', () => {
      agent.configure({ licenseKey: 'PBL-X' });
      agent.configure({ tenantId: 'tenant_y' });
      const config = agent.getConfig();
      expect(config.licenseKey).toBe('PBL-X');
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
      agent.configure({ enabled: false, licenseKey: 'PBL-TEST' });
      agent.start();
      // No error thrown
    });
  });

  describe('stop', () => {
    it('can be called safely when not running', () => {
      expect(() => agent.stop()).not.toThrow();
    });
  });

  describe('a report', () => {
    let server: http.Server;
    let base: string;
    const seen: { path: string; headers: http.IncomingHttpHeaders; body?: any }[] = [];
    let analyticsDown = false;

    beforeAll(async () => {
      process.env.INTERNAL_SERVICE_KEY = KEY;
      server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          seen.push({ path: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
          res.setHeader('content-type', 'application/json');
          if (req.url === '/analytics/internal/v1/reporting/summary') {
            if (analyticsDown) { res.statusCode = 503; return res.end('{}'); }
            return res.end(JSON.stringify({
              periodStart: 'p0', periodEnd: 'p1',
              usage: { totalRequests: 7, blockedRequests: 2, activeUsers: 3, modelBreakdown: [{ modelId: 'm', requests: 7 }] },
              cost: { totalCost: 1.25, costByModel: [{ modelId: 'm', cost: 1.25 }], costByUser: [] },
            }));
          }
          if (req.url === '/policy/v1/compliance/status/tenant_x') {
            return res.end(JSON.stringify([
              { framework: 'hipaa', status: 'partial', passedControls: 5, totalControls: 8, controls: [{ secret: true }] },
              { framework: 'gdpr', status: 'disabled', passedControls: 0, totalControls: 9 },
            ]));
          }
          if (req.url === '/platform/validate-license') return res.end(JSON.stringify({ valid: true }));
          if (req.url === '/platform/ingest') return res.end(JSON.stringify({ accepted: true }));
          res.statusCode = 404; res.end('{}');
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => { server.close(); delete process.env.INTERNAL_SERVICE_KEY; });
    beforeEach(() => { seen.length = 0; analyticsDown = false; });

    const configured = async () => {
      agent.configure({
        ...configFromEnv({
          PROBALINE_LICENSE_KEY: 'PBL-1', TENANT_ID: 'tenant_x', REPORTING_ENABLED: 'true',
          PROBALINE_REPORTING_URL: `${base}/platform/`, ANALYTICS_URL: `${base}/analytics`, POLICY_ENGINE_URL: `${base}/policy`,
        }),
      });
      expect(await agent.validateLicense()).toBe(true);
    };

    it('sends this install\'s real usage, cost and compliance, read with a signed token', async () => {
      await configured();
      await agent.report();
      expect(agent.getStatus()).toMatchObject({ lastReportStatus: 'success', reportCount: 1 });
      const summary = seen.find((s) => s.path.endsWith('/reporting/summary'))!;
      expect(verifyInternal(summary.headers[INTERNAL_HEADER] as string, KEY, 'analytics')).toMatchObject({ tenantId: 'tenant_x', role: 'reporting_agent' });
      const sent = seen.find((s) => s.path === '/platform/ingest')!.body;
      expect(sent).toMatchObject({
        licenseKey: 'PBL-1', tenantId: 'tenant_x',
        data: {
          usageMetrics: { totalRequests: 7, blockedRequests: 2, activeUsers: 3, periodStart: 'p0' },
          costData: { totalCost: 1.25, periodEnd: 'p1' },
          complianceStatus: { enabledFrameworks: ['hipaa'], frameworkStatus: [{ framework: 'hipaa', status: 'partial', passedControls: 5, totalControls: 8 }] },
        },
      });
      expect(JSON.stringify(sent)).not.toContain('secret');
      expect(sent.data.auditLogs).toBeUndefined();
    });

    it('sends nothing when it cannot read the numbers, instead of a report of zeros', async () => {
      await configured();
      analyticsDown = true;
      await agent.report();
      expect(agent.getStatus().lastReportStatus).toBe('failed');
      expect(seen.some((s) => s.path === '/platform/ingest')).toBe(false);
    });

    it('never turns on sending audit records', () => {
      agent.configure({ sync: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: true } });
      expect(agent.getConfig().sync.auditLogs).toBe(false);
    });
  });
});
