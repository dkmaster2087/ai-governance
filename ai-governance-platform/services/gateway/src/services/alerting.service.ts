import axios from 'axios';
import { createLogger } from '@ai-governance/utils';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const logger = createLogger('gateway:alerting');

export type AlertType = 'budget_threshold' | 'policy_violation_spike' | 'license_expiry' | 'shadow_ai_activity' | 'service_unhealthy' | 'pii_leakage';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertChannel = 'webhook' | 'email';

export interface AlertRule {
  ruleId: string;
  tenantId: string;
  name: string;
  type: AlertType;
  severity: AlertSeverity;
  channel: AlertChannel;
  destination: string;       // Webhook URL or email address
  enabled: boolean;
  config: Record<string, any>; // Type-specific config (threshold %, time window, etc.)
  createdAt: string;
  lastTriggeredAt?: string;
  triggerCount: number;
}

export interface AlertEvent {
  alertId: string;
  ruleId: string;
  tenantId: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  metadata: Record<string, any>;
  timestamp: string;
  delivered: boolean;
}

const DEFAULT_RULES: Omit<AlertRule, 'ruleId' | 'tenantId' | 'destination' | 'createdAt' | 'triggerCount'>[] = [
  { name: 'Budget 80% Alert', type: 'budget_threshold', severity: 'warning', channel: 'webhook', enabled: true, config: { thresholdPercent: 80 } },
  { name: 'Budget 100% Critical', type: 'budget_threshold', severity: 'critical', channel: 'webhook', enabled: true, config: { thresholdPercent: 100 } },
  { name: 'Policy Violation Spike', type: 'policy_violation_spike', severity: 'warning', channel: 'webhook', enabled: true, config: { threshold: 10, windowMinutes: 60 } },
  { name: 'License Expiring Soon', type: 'license_expiry', severity: 'warning', channel: 'webhook', enabled: true, config: { daysBeforeExpiry: 30 } },
  { name: 'Shadow AI Activity', type: 'shadow_ai_activity', severity: 'warning', channel: 'webhook', enabled: true, config: { minAttempts: 5, windowMinutes: 60 } },
  { name: 'PII in Response', type: 'pii_leakage', severity: 'critical', channel: 'webhook', enabled: true, config: { minFindings: 1 } },
];

export class AlertingService {
  private client: DynamoDBDocumentClient;
  private table: string;

  constructor() {
    const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
    this.client = DynamoDBDocumentClient.from(dynamo);
    this.table = process.env.ALERTS_TABLE || 'ai-gov-alerts-dev';
  }

  /** Get all alert rules for a tenant */
  async getRules(tenantId: string): Promise<AlertRule[]> {
    try {
      const result = await this.client.send(new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'tenantId = :tid',
        ExpressionAttributeValues: { ':tid': tenantId },
      }));
      return (result.Items || []) as AlertRule[];
    } catch {
      return [];
    }
  }

  /** Create a new alert rule */
  async createRule(rule: AlertRule): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.table, Item: rule }));
    logger.info('Alert rule created', { tenantId: rule.tenantId, ruleId: rule.ruleId, type: rule.type });
  }

  /** Get default rules template for a new tenant */
  getDefaultRules(tenantId: string, webhookUrl: string): AlertRule[] {
    return DEFAULT_RULES.map((r) => ({
      ...r,
      ruleId: `alert_${randomUUID().slice(0, 8)}`,
      tenantId,
      destination: webhookUrl,
      createdAt: new Date().toISOString(),
      triggerCount: 0,
    }));
  }

  /** Trigger an alert — evaluate rules and send notifications */
  async trigger(tenantId: string, type: AlertType, data: { title: string; message: string; severity?: AlertSeverity; metadata?: Record<string, any> }): Promise<AlertEvent | null> {
    const rules = await this.getRules(tenantId);
    const matchingRules = rules.filter((r) => r.type === type && r.enabled);

    if (matchingRules.length === 0) return null;

    // Use the highest severity matching rule
    const rule = matchingRules.sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity))[0];

    const event: AlertEvent = {
      alertId: `evt_${randomUUID().slice(0, 12)}`,
      ruleId: rule.ruleId,
      tenantId,
      type,
      severity: data.severity || rule.severity,
      title: data.title,
      message: data.message,
      metadata: data.metadata || {},
      timestamp: new Date().toISOString(),
      delivered: false,
    };

    // Send notification
    const delivered = await this.deliver(rule, event);
    event.delivered = delivered;

    // Update rule trigger count
    try {
      await this.client.send(new UpdateCommand({
        TableName: this.table,
        Key: { tenantId, ruleId: rule.ruleId },
        UpdateExpression: 'SET lastTriggeredAt = :ts, triggerCount = triggerCount + :one',
        ExpressionAttributeValues: { ':ts': event.timestamp, ':one': 1 },
      }));
    } catch { /* non-critical */ }

    return event;
  }

  /** Deliver alert to the configured channel */
  private async deliver(rule: AlertRule, event: AlertEvent): Promise<boolean> {
    if (rule.channel === 'webhook') {
      return this.sendWebhook(rule.destination, event);
    }
    // Email channel would go here (SES integration)
    logger.warn('Unsupported alert channel', { channel: rule.channel });
    return false;
  }

  /** Send webhook notification */
  private async sendWebhook(url: string, event: AlertEvent): Promise<boolean> {
    try {
      await axios.post(url, {
        source: 'aegis-ai',
        event: event.type,
        severity: event.severity,
        title: event.title,
        message: event.message,
        tenantId: event.tenantId,
        metadata: event.metadata,
        timestamp: event.timestamp,
        alertId: event.alertId,
      }, { timeout: 10000 });
      logger.info('Webhook alert delivered', { alertId: event.alertId, url: url.slice(0, 30) + '...' });
      return true;
    } catch (err: any) {
      logger.error('Webhook delivery failed', { alertId: event.alertId, error: err.message });
      return false;
    }
  }
}

function severityOrder(s: AlertSeverity): number {
  return s === 'critical' ? 3 : s === 'warning' ? 2 : 1;
}
