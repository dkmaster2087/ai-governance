import { createApiClient } from './http';

const gateway = createApiClient('/api');

export type AlertKind = 'stopped_spike' | 'answer_pii' | 'shadow_ai' | 'spend';

export interface AlertConfig { count?: number; minutes?: number; monthlyBudgetUSD?: number; percent?: number }

export interface AlertRule {
  ruleId: string;
  name: string;
  kind: AlertKind;
  enabled: boolean;
  config: AlertConfig;
  emails: string[];
  /** A shortened address; the full one is never shown again. */
  webhook?: string;
  description: string;
  createdAt: string;
  lastFiredAt?: string;
  firedCount: number;
}

export interface AlertInput {
  name: string;
  kind: AlertKind;
  enabled?: boolean;
  config: AlertConfig;
  emails: string[];
  /** Leave undefined to keep the current webhook; null removes it. */
  webhookUrl?: string | null;
}

export interface Delivery { email?: 'sent' | 'failed'; webhook?: 'sent' | 'failed'; error?: string }

export interface AlertEvent {
  alertId: string;
  alertRuleId: string;
  name: string;
  kind: AlertKind;
  title: string;
  message: string;
  firedAt: string;
  delivery: Delivery;
  test?: boolean;
}

export const KINDS: Array<{ value: AlertKind; label: string; hint: string; defaults: AlertConfig }> = [
  { value: 'stopped_spike', label: 'Many requests stopped', hint: 'Someone may be trying to get around your rules, or a rule may be too strict.', defaults: { count: 10, minutes: 60 } },
  { value: 'answer_pii', label: 'Personal data in AI answers', hint: 'An AI answer or tool result contained personal data, which Probaline removed.', defaults: { count: 1, minutes: 60 } },
  { value: 'shadow_ai', label: 'Unapproved AI tools in use', hint: 'The browser extension saw people visit AI tools you haven’t approved.', defaults: { count: 5, minutes: 60 } },
  { value: 'spend', label: 'Spend near budget', hint: 'This month’s AI spend passes a share of your budget.', defaults: { monthlyBudgetUSD: 1000, percent: 80 } },
];
export const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label])) as Record<AlertKind, string>;

export const listAlerts = async () => (await gateway.get<AlertRule[]>('/v1/alerts/rules')).data;
export const listAlertEvents = async () => (await gateway.get<AlertEvent[]>('/v1/alerts/events')).data;
export const createAlert = async (input: AlertInput) => (await gateway.post<AlertRule & { signingSecret?: string }>('/v1/alerts/rules', input)).data;
export const updateAlert = async (ruleId: string, change: Partial<AlertInput>) =>
  (await gateway.patch<AlertRule & { signingSecret?: string }>(`/v1/alerts/rules/${encodeURIComponent(ruleId)}`, change)).data;
export const deleteAlert = async (ruleId: string) => (await gateway.delete(`/v1/alerts/rules/${encodeURIComponent(ruleId)}`)).data;
export const testAlert = async (ruleId: string) => (await gateway.post<{ delivery: Delivery }>(`/v1/alerts/rules/${encodeURIComponent(ruleId)}/test`)).data;
