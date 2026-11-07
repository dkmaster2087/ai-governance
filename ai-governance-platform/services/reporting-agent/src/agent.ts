import axios from 'axios';
import { createLogger, INTERNAL_HEADER, internalKeyFromEnv, signInternal } from '@ai-governance/utils';

const logger = createLogger('reporting-agent:core');

export interface ReportingConfig {
  licenseKey: string;
  /** The Probaline platform's reporting address, e.g. https://app.probaline.com/api/v1/reporting */
  saasEndpoint: string;
  /** This install's own services, on the internal network. */
  analyticsUrl: string;
  policyEngineUrl: string;
  tenantId: string;
  reportingInterval: number;  // seconds between reports (default 300 = 5 min)
  enabled: boolean;
  sync: {
    usageMetrics: boolean;
    costData: boolean;
    complianceStatus: boolean;
    /** Always false: audit records never leave the company's deployment. Kept so old settings still parse. */
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
}

const AGENT_VERSION = '1.0.0';
const flag = (v: string | undefined, fallback: boolean) => (v === undefined || v === '' ? fallback : v === 'true');

/** Settings come from the environment, so a deployment configures the agent without calling its API. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ReportingConfig {
  return {
    licenseKey: env.PROBALINE_LICENSE_KEY ?? '',
    saasEndpoint: (env.PROBALINE_REPORTING_URL ?? '').replace(/\/+$/, ''),
    analyticsUrl: (env.ANALYTICS_URL ?? 'http://localhost:3003').replace(/\/+$/, ''),
    policyEngineUrl: (env.POLICY_ENGINE_URL ?? 'http://localhost:3001').replace(/\/+$/, ''),
    tenantId: env.TENANT_ID ?? '',
    reportingInterval: Math.max(60, parseInt(env.REPORTING_INTERVAL_SECONDS ?? '300', 10) || 300),
    enabled: flag(env.REPORTING_ENABLED, false),
    sync: {
      usageMetrics: flag(env.REPORT_USAGE, true),
      costData: flag(env.REPORT_COST, true),
      complianceStatus: flag(env.REPORT_COMPLIANCE, true),
      auditLogs: false, // never sent: audit records stay inside the company's deployment
    },
  };
}

export class ReportingAgent {
  private static instance: ReportingAgent;
  private config: ReportingConfig = configFromEnv();
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
    this.config.sync.auditLogs = false;
    logger.info('Reporting config updated', { tenantId: this.config.tenantId, enabled: this.config.enabled });

    // Restart interval if running
    if (this.intervalHandle) {
      this.stop();
      if (this.config.enabled) this.start();
    }
  }

  /** Start the reporting loop */
  start(): void {
    if (this.intervalHandle) return;
    if (!this.config.enabled || !this.config.licenseKey || !this.config.saasEndpoint || !this.config.tenantId) {
      logger.info('Reporting agent not started (disabled, or license key, platform address or company not set)');
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

    try {
      // A report of zeros would look real, so a part that can't be read fails the whole report instead.
      if (this.config.sync.usageMetrics || this.config.sync.costData) {
        const s = await this.readSummary();
        const period = { periodStart: s.periodStart, periodEnd: s.periodEnd };
        if (this.config.sync.usageMetrics) payload.data.usageMetrics = { ...s.usage, ...period };
        if (this.config.sync.costData) payload.data.costData = { ...s.cost, ...period };
      }
      if (this.config.sync.complianceStatus) payload.data.complianceStatus = await this.collectComplianceStatus();
    } catch (err: any) {
      this.lastReportStatus = 'failed';
      logger.error('Could not collect the report', { error: err.message });
      return;
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

  /** A token for this install's own services: on behalf of the company, limited to the reporting summary. */
  private internalHeaders(audience: string) {
    const token = signInternal({ tenantId: this.config.tenantId, userId: 'reporting-agent', role: 'reporting_agent' }, internalKeyFromEnv(), audience);
    return { [INTERNAL_HEADER]: token };
  }

  /** Usage and cost for the last 24 hours, from this install's analytics. */
  private async readSummary(): Promise<any> {
    const { data } = await axios.get(`${this.config.analyticsUrl}/internal/v1/reporting/summary`, { headers: this.internalHeaders('analytics'), timeout: 15000 });
    return data;
  }

  /** Which frameworks are on and how many of their controls are met, without the controls themselves. */
  private async collectComplianceStatus(): Promise<ComplianceStatus> {
    const { data } = await axios.get(`${this.config.policyEngineUrl}/v1/compliance/status/${encodeURIComponent(this.config.tenantId)}`, { timeout: 15000 });
    const frameworks: any[] = Array.isArray(data) ? data : [];
    const on = frameworks.filter((f) => f.status !== 'disabled');
    return {
      enabledFrameworks: on.map((f) => f.framework),
      frameworkStatus: on.map((f) => ({ framework: f.framework, status: f.status, passedControls: f.passedControls ?? 0, totalControls: f.totalControls ?? 0 })),
    };
  }
}
