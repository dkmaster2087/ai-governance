import axios from 'axios';
import { createLogger } from '@ai-governance/utils';

const logger = createLogger('reporting-agent:core');

export interface ReportingConfig {
  licenseKey: string;
  saasEndpoint: string;       // e.g., https://platform.aegis-ai.com/api/v1/reporting
  tenantId: string;
  reportingInterval: number;  // seconds between reports (default 300 = 5 min)
  enabled: boolean;
  sync: {
    usageMetrics: boolean;
    costData: boolean;
    complianceStatus: boolean;
    auditLogs: boolean;
  };
}

export interface ReportPayload {
  licenseKey: string;
  tenantId: string;
  timestamp: string;
  agentVersion: string;
  data: {
    usageMetrics?: UsageMetrics;
    costData?: CostData;
    complianceStatus?: ComplianceStatus;
    auditLogs?: AuditLogEntry[];
  };
}

interface UsageMetrics {
  totalRequests: number;
  blockedRequests: number;
  activeUsers: number;
  modelBreakdown: { modelId: string; requests: number }[];
  periodStart: string;
  periodEnd: string;
}

interface CostData {
  totalCost: number;
  costByModel: { modelId: string; cost: number }[];
  costByUser: { userId: string; cost: number }[];
  periodStart: string;
  periodEnd: string;
}

interface ComplianceStatus {
  enabledFrameworks: string[];
  frameworkStatus: { framework: string; status: string; passedControls: number; totalControls: number }[];
  activePolicies: number;
  totalRules: number;
}

interface AuditLogEntry {
  requestId: string;
  userId: string;
  model: string;
  decision: string;
  timestamp: string;
  tokens: number;
}

const AGENT_VERSION = '1.0.0';
const DEFAULT_CONFIG: ReportingConfig = {
  licenseKey: '',
  saasEndpoint: 'http://localhost:3000/v1/reporting/ingest',
  tenantId: '',
  reportingInterval: 300,
  enabled: false,
  sync: { usageMetrics: true, costData: true, complianceStatus: true, auditLogs: false },
};

export class ReportingAgent {
  private static instance: ReportingAgent;
  private config: ReportingConfig = { ...DEFAULT_CONFIG };
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastReportAt: string | null = null;
  private lastReportStatus: 'success' | 'failed' | 'pending' | null = null;
  private licenseValidated = false;
  private reportCount = 0;

  static getInstance(): ReportingAgent {
    if (!ReportingAgent.instance) {
      ReportingAgent.instance = new ReportingAgent();
    }
    return ReportingAgent.instance;
  }

  getConfig(): ReportingConfig { return { ...this.config }; }
  getStatus() {
    return {
      enabled: this.config.enabled,
      licenseValidated: this.licenseValidated,
      lastReportAt: this.lastReportAt,
      lastReportStatus: this.lastReportStatus,
      reportCount: this.reportCount,
      reportingInterval: this.config.reportingInterval,
      syncConfig: this.config.sync,
    };
  }

  /** Update configuration */
  configure(updates: Partial<ReportingConfig>): void {
    this.config = { ...this.config, ...updates };
    if (updates.sync) this.config.sync = { ...this.config.sync, ...updates.sync };
    logger.info('Reporting config updated', { tenantId: this.config.tenantId, enabled: this.config.enabled });

    // Restart interval if running
    if (this.intervalHandle) {
      this.stop();
      if (this.config.enabled) this.start();
    }
  }

  /** Start the reporting loop */
  start(): void {
    if (!this.config.enabled || !this.config.licenseKey) {
      logger.info('Reporting agent not started (disabled or no license key)');
      return;
    }

    logger.info('Starting reporting agent', { interval: this.config.reportingInterval + 's', tenantId: this.config.tenantId });

    // Validate license on first start
    this.validateLicense().catch(() => {});

    // Start periodic reporting
    this.intervalHandle = setInterval(() => {
      this.report().catch((err) => {
        logger.error('Report cycle failed', { error: err.message });
      });
    }, this.config.reportingInterval * 1000);
  }

  /** Stop the reporting loop */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      logger.info('Reporting agent stopped');
    }
  }

  /** Validate license key against SaaS platform */
  async validateLicense(): Promise<boolean> {
    try {
      const resp = await axios.post(`${this.config.saasEndpoint}/validate-license`, {
        licenseKey: this.config.licenseKey,
        tenantId: this.config.tenantId,
        agentVersion: AGENT_VERSION,
      }, { timeout: 15000 });

      this.licenseValidated = resp.data?.valid === true;
      logger.info('License validation result', { valid: this.licenseValidated });
      return this.licenseValidated;
    } catch (err: any) {
      logger.error('License validation failed', { error: err.message });
      this.licenseValidated = false;
      return false;
    }
  }

  /** Collect and send a report to the SaaS platform */
  async report(): Promise<void> {
    if (!this.config.enabled || !this.licenseValidated) return;

    this.lastReportStatus = 'pending';
    const payload: ReportPayload = {
      licenseKey: this.config.licenseKey,
      tenantId: this.config.tenantId,
      timestamp: new Date().toISOString(),
      agentVersion: AGENT_VERSION,
      data: {},
    };

    // Collect data based on sync config
    if (this.config.sync.usageMetrics) {
      payload.data.usageMetrics = await this.collectUsageMetrics();
    }
    if (this.config.sync.costData) {
      payload.data.costData = await this.collectCostData();
    }
    if (this.config.sync.complianceStatus) {
      payload.data.complianceStatus = await this.collectComplianceStatus();
    }
    if (this.config.sync.auditLogs) {
      payload.data.auditLogs = await this.collectAuditLogs();
    }

    try {
      await axios.post(`${this.config.saasEndpoint}/ingest`, payload, { timeout: 30000 });
      this.lastReportAt = payload.timestamp;
      this.lastReportStatus = 'success';
      this.reportCount++;
      logger.info('Report sent successfully', { reportCount: this.reportCount });
    } catch (err: any) {
      this.lastReportStatus = 'failed';
      logger.error('Report delivery failed', { error: err.message });
    }
  }

  // Data collectors — in production these query local DynamoDB/services
  private async collectUsageMetrics(): Promise<UsageMetrics> {
    // Query local gateway for metrics
    try {
      const { data } = await axios.get('http://localhost:3000/v1/cost/summary/' + this.config.tenantId, {
        headers: { 'x-tenant-id': this.config.tenantId, authorization: 'Bearer test-key' },
        timeout: 5000,
      });
      return {
        totalRequests: data.totalRequests || 0,
        blockedRequests: data.blockedRequests || 0,
        activeUsers: data.activeUsers || 0,
        modelBreakdown: data.modelBreakdown || [],
        periodStart: new Date(Date.now() - 86400000).toISOString(),
        periodEnd: new Date().toISOString(),
      };
    } catch {
      return { totalRequests: 0, blockedRequests: 0, activeUsers: 0, modelBreakdown: [], periodStart: '', periodEnd: '' };
    }
  }

  private async collectCostData(): Promise<CostData> {
    try {
      const { data } = await axios.get('http://localhost:3000/v1/cost/breakdown/' + this.config.tenantId, {
        headers: { 'x-tenant-id': this.config.tenantId, authorization: 'Bearer test-key' },
        timeout: 5000,
      });
      return {
        totalCost: data.totalCost || 0,
        costByModel: data.costByModel || [],
        costByUser: data.costByUser || [],
        periodStart: new Date(Date.now() - 86400000).toISOString(),
        periodEnd: new Date().toISOString(),
      };
    } catch {
      return { totalCost: 0, costByModel: [], costByUser: [], periodStart: '', periodEnd: '' };
    }
  }

  private async collectComplianceStatus(): Promise<ComplianceStatus> {
    try {
      const { data } = await axios.get('http://localhost:3001/v1/compliance/status/' + this.config.tenantId, { timeout: 5000 });
      const frameworks = Array.isArray(data) ? data : [];
      return {
        enabledFrameworks: frameworks.filter((f: any) => f.status === 'enabled').map((f: any) => f.framework),
        frameworkStatus: frameworks.map((f: any) => ({ framework: f.framework, status: f.status, passedControls: f.passedControls || 0, totalControls: f.totalControls || 0 })),
        activePolicies: 0,
        totalRules: 0,
      };
    } catch {
      return { enabledFrameworks: [], frameworkStatus: [], activePolicies: 0, totalRules: 0 };
    }
  }

  private async collectAuditLogs(): Promise<AuditLogEntry[]> {
    // Only collected if tenant opts in
    return [];
  }
}
