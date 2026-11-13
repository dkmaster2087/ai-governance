import { randomBytes } from 'crypto';
import { batchedCounter } from './batched-counter';
import { allPages, collection } from '@ai-governance/storage';
import { AuditLog } from '@ai-governance/types';
import { createLogger } from '@ai-governance/utils';
import { callBackend } from '../mcp/egress';
import { allowPrivateDestinations, checkDestinationUrl, urlHint } from '../log-export/destinations';
import { signatureHeader } from '../log-export/formats';
import { mailer, Mailer } from './email';

const logger = createLogger('gateway:alerting');

/**
 * Company alerts. Each rule watches one thing and tells people by email or webhook when it happens:
 *
 *   stopped_spike  N requests or tool calls stopped within M minutes
 *   answer_pii     personal data removed from N AI answers or tool results within M minutes
 *   shadow_ai      N visits to unapproved AI tools reported by the browser extension within M minutes
 *   spend          this month's AI spend passes a share of a budget
 *
 * Counts live in the shared database, so they hold across gateway instances; a rule fires once when its
 * count is reached in a window (or, for spend, once a month when the line is crossed). Signals never slow
 * down or fail a request: they run after the response and only log their own errors.
 */
export const ALERT_KINDS = ['stopped_spike', 'answer_pii', 'shadow_ai', 'spend'] as const;
export type AlertKind = typeof ALERT_KINDS[number];

export interface AlertRule {
  tenantId: string;
  ruleId: string;
  name: string;
  kind: AlertKind;
  enabled: boolean;
  /** stopped_spike, answer_pii, shadow_ai: count and minutes. spend: monthlyBudgetUSD and percent. */
  config: { count?: number; minutes?: number; monthlyBudgetUSD?: number; percent?: number };
  emails: string[];
  webhookUrl?: string;
  /** HMAC key for X-Probaline-Signature on webhooks; shown to the admin once. */
  signingSecret?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  lastFiredAt?: string;
  firedCount: number;
}

export interface AlertEvent {
  tenantId: string;
  ruleId: string;           // `event#<time>#<id>`: kept in the same table as the rules
  alertId: string;
  alertRuleId: string;
  name: string;
  kind: AlertKind;
  title: string;
  message: string;
  firedAt: string;
  delivery: { email?: 'sent' | 'failed'; webhook?: 'sent' | 'failed'; error?: string };
  test?: boolean;
  ttl: number;
}

export const MAX_RULES = 20;
export const MAX_EMAILS = 10;
const EVENT_DAYS = 90;
const isRule = (r: { ruleId?: string }) => String(r.ruleId).startsWith('alert_');
export const newAlertId = () => `alert_${randomBytes(5).toString('hex')}`;
export const newSigningSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

export const DEFAULTS: Record<AlertKind, AlertRule['config']> = {
  stopped_spike: { count: 10, minutes: 60 },
  answer_pii: { count: 1, minutes: 60 },
  shadow_ai: { count: 5, minutes: 60 },
  spend: { monthlyBudgetUSD: 1000, percent: 80 },
};

/** What the rule watches, in words, for the dashboard and the alert itself. */
export function describeRule(r: Pick<AlertRule, 'kind' | 'config'>): string {
  const n = r.config.count ?? DEFAULTS[r.kind].count ?? 1;
  const within = `within ${minutes(r.config.minutes ?? 60)}`;
  switch (r.kind) {
    case 'stopped_spike': return `${n} or more requests stopped ${within}`;
    case 'answer_pii': return `Personal data removed from ${n === 1 ? 'an AI answer' : `${n} AI answers`} ${within}`;
    case 'shadow_ai': return `${n} or more visits to unapproved AI tools ${within}`;
    case 'spend': return `This month’s AI spend passes ${r.config.percent ?? 80}% of $${(r.config.monthlyBudgetUSD ?? 0).toLocaleString('en-US')}`;
  }
}
const minutes = (m: number) => (m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`);

/** A rule as the dashboard sees it: no signing secret, and only a hint of the webhook address. */
export function ruleView(r: AlertRule) {
  const { signingSecret: _s, webhookUrl, ...rest } = r;
  return { ...rest, ...(webhookUrl ? { webhook: urlHint(new URL(webhookUrl)) } : {}), description: describeRule(r) };
}

export class AlertingService {
  private cache = new Map<string, { rules: AlertRule[]; until: number }>();

  constructor(
    private send: () => Mailer = mailer,
    private post: (url: string, headers: Record<string, string>, body: string) => Promise<number> = defaultPost,
    private now: () => Date = () => new Date(),
    private cacheMs = 30_000,
  ) {}

  private table = () => collection<Record<string, any>>('alerts');
  private counters = () => collection<{ tenantId: string; period: string; count?: number; ttl?: number }>('metrics');

  // ── Rules ──────────────────────────────────────────────────────────────────────────────────

  async rules(tenantId: string): Promise<AlertRule[]> {
    const all = await allPages((after) => this.table().query({ partition: tenantId, range: { beginsWith: 'alert_' }, after }));
    return (all.filter(isRule) as AlertRule[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async rule(tenantId: string, ruleId: string): Promise<AlertRule | null> {
    if (!ruleId.startsWith('alert_')) return null;
    return (await this.table().get({ tenantId, ruleId })) as AlertRule | null;
  }

  async save(rule: AlertRule): Promise<void> {
    await this.table().put(rule as unknown as Record<string, any>);
    this.cache.delete(rule.tenantId);
  }

  async remove(tenantId: string, ruleId: string): Promise<void> {
    await this.table().delete({ tenantId, ruleId });
    this.cache.delete(tenantId);
  }

  async events(tenantId: string, limit = 50): Promise<AlertEvent[]> {
    const page = await this.table().query({ partition: tenantId, range: { beginsWith: 'event#' }, order: 'desc', limit });
    return page.items as AlertEvent[];
  }

  private async active(tenantId: string, kind: AlertKind): Promise<AlertRule[]> {
    let hit = this.cache.get(tenantId);
    if (!hit || hit.until < Date.now()) {
      hit = { rules: await this.rules(tenantId), until: Date.now() + this.cacheMs };
      this.cache.set(tenantId, hit);
    }
    return hit.rules.filter((r) => r.enabled && r.kind === kind);
  }

  // ── Signals ────────────────────────────────────────────────────────────────────────────────

  /** After every case file: stopped requests, personal data in answers, and spend. */
  async fromAuditRecord(log: AuditLog): Promise<void> {
    const m = log.metadata ?? {};
    if (m.test === 'true') return;
    if (log.eventType === 'request_blocked') await this.count(log.tenantId, 'stopped_spike', 1);
    const answerPii = m.answerPiiRemoved === 'true' || (m.kind === 'mcp_tool_call' && log.piiDetected);
    if (answerPii) await this.count(log.tenantId, 'answer_pii', 1);
    if (log.estimatedCost > 0) await this.spend(log.tenantId, log.estimatedCost);
  }

  /** Browser-extension sightings of unapproved AI tools. */
  async fromShadowAi(tenantId: string, visits: number): Promise<void> {
    if (visits > 0) await this.count(tenantId, 'shadow_ai', visits);
  }

  /** Same as the methods above, but never throws: for the request path. */
  signal(work: () => Promise<void>): void {
    work().catch((err) => logger.warn('Alert check failed', { error: (err as Error).message }));
  }

  /**
   * Counted in batches (written once a second). The check runs on each write's result, so the write that takes the
   * count past the threshold fires the alert: once per window, across every gateway copy.
   */
  private async count(tenantId: string, kind: Exclude<AlertKind, 'spend'>, n: number) {
    const rules = await this.active(tenantId, kind);
    if (!rules.length) return;
    const now = this.now();
    for (const rule of rules) {
      const threshold = Math.max(1, rule.config.count ?? 1);
      const windowMs = Math.max(1, rule.config.minutes ?? 60) * 60_000;
      const bucket = Math.floor(now.getTime() / windowMs);
      await batchedCounter().addLater(tenantId, `alert#${rule.ruleId}#${bucket}`, n, Math.ceil((2 * windowMs) / 1000), async (after, added) => {
        if (after - added < threshold && after >= threshold) {
          await this.fire(rule, this.headline(rule, after), `${describeRule(rule)}: ${after} so far in this window.`);
        }
      });
    }
  }

  private async spend(tenantId: string, usd: number) {
    const rules = await this.active(tenantId, 'spend');
    if (!rules.length) return;
    const month = this.now().toISOString().slice(0, 7);
    const cents = Math.max(1, Math.round(usd * 100));
    await batchedCounter().addLater(tenantId, `alertspend#${month}`, cents, 40 * 86_400, async (after, added) => {
      for (const rule of rules) {
        const line = Math.round((rule.config.monthlyBudgetUSD ?? 0) * (rule.config.percent ?? 80));
        if (line > 0 && after - added < line && after >= line) {
          await this.fire(rule, `AI spend passed ${rule.config.percent ?? 80}% of the monthly budget`,
            `${describeRule(rule)}. Spent so far this month: $${(after / 100).toFixed(2)} (counted since the alert was set up${rule.createdAt.slice(0, 7) === month ? ` on ${rule.createdAt.slice(0, 10)}` : ''}).`);
        }
      }
    });
  }

  /** When a spend alert is created mid-month, start its count from what was already spent. */
  async seedSpend(tenantId: string, spentThisMonthUSD: number) {
    const month = this.now().toISOString().slice(0, 7);
    const key = { tenantId, period: `alertspend#${month}` };
    const current = (await this.counters().get(key))?.count ?? 0;
    const want = Math.round(spentThisMonthUSD * 100);
    if (want > current) await this.counters().update(key, { increment: { count: want - current }, set: { ttl: Math.floor(this.now().getTime() / 1000) + 40 * 86_400 } });
  }

  private headline(rule: AlertRule, n: number): string {
    switch (rule.kind) {
      case 'stopped_spike': return `${n} requests stopped in the last ${minutes(rule.config.minutes ?? 60)}`;
      case 'answer_pii': return `Personal data was removed from ${n === 1 ? 'an AI answer' : `${n} AI answers`}`;
      case 'shadow_ai': return `${n} visits to unapproved AI tools`;
      default: return rule.name;
    }
  }

  // ── Delivery ───────────────────────────────────────────────────────────────────────────────

  async fire(rule: AlertRule, title: string, message: string, test = false): Promise<AlertEvent> {
    const firedAt = this.now().toISOString();
    const alertId = `evt_${randomBytes(6).toString('hex')}`;
    const delivery: AlertEvent['delivery'] = {};
    const dashboard = process.env.DASHBOARD_URL?.replace(/\/$/, '');
    const text = [message, '', `Alert: ${rule.name}${test ? ' (test)' : ''}`, ...(dashboard ? [`Open Probaline: ${dashboard}`] : []),
      '', 'You get this because an administrator added you to this alert in Probaline.'].join('\n');

    if (rule.emails.length) {
      try {
        const m = this.send();
        if (!m.enabled) throw new Error('Email isn’t set up on this Probaline install');
        await m.send({ to: rule.emails, subject: `${test ? '[Test] ' : ''}Probaline: ${title}`, text });
        delivery.email = 'sent';
      } catch (err) {
        delivery.email = 'failed'; delivery.error = (err as Error).message;
        logger.error('Alert email failed', { tenantId: rule.tenantId, ruleId: rule.ruleId, error: (err as Error).message });
      }
    }
    if (rule.webhookUrl) {
      const body = JSON.stringify({
        source: 'probaline', alertId, ruleId: rule.ruleId, name: rule.name, kind: rule.kind, title, message,
        tenantId: rule.tenantId, firedAt, test,
        // Chat tools (Slack, Teams, Google Chat) show `text`.
        text: `*Probaline:* ${title}\n${message}`,
      });
      const headers: Record<string, string> = { 'user-agent': 'Probaline-Alerts/1.0', 'x-probaline-alert': alertId };
      if (rule.signingSecret) headers['x-probaline-signature'] = signatureHeader(rule.signingSecret, body, Math.floor(this.now().getTime() / 1000));
      try {
        const status = await this.post(rule.webhookUrl, headers, body);
        if (status < 200 || status >= 300) throw new Error(`The webhook answered ${status}`);
        delivery.webhook = 'sent';
      } catch (err) {
        delivery.webhook = 'failed'; delivery.error = (err as Error).message;
        logger.error('Alert webhook failed', { tenantId: rule.tenantId, ruleId: rule.ruleId, error: (err as Error).message });
      }
    }

    const event: AlertEvent = {
      tenantId: rule.tenantId, ruleId: `event#${firedAt}#${alertId}`, alertId, alertRuleId: rule.ruleId, name: rule.name, kind: rule.kind,
      title, message, firedAt, delivery, ...(test ? { test: true } : {}),
      ttl: Math.floor(this.now().getTime() / 1000) + EVENT_DAYS * 86_400,
    };
    await this.table().put(event as unknown as Record<string, any>);
    if (!test) {
      await this.table().update({ tenantId: rule.tenantId, ruleId: rule.ruleId }, { set: { lastFiredAt: firedAt }, increment: { firedCount: 1 }, ifExists: true })
        .catch(() => undefined);
      this.cache.delete(rule.tenantId);
    }
    logger.info('Alert fired', { tenantId: rule.tenantId, ruleId: rule.ruleId, kind: rule.kind, test, delivery });
    return event;
  }
}

/** Webhooks: https only, no private or metadata addresses (checked again at connection), no redirects. */
async function defaultPost(url: string, headers: Record<string, string>, body: string): Promise<number> {
  const u = checkDestinationUrl(url);
  const r = await callBackend({ url: u, method: 'POST', headers, body, contentType: 'application/json', timeoutMs: 10_000, maxBytes: 4096, allowPrivate: allowPrivateDestinations() });
  return r.status;
}

let shared: AlertingService | null = null;
export const alerting = () => (shared ??= new AlertingService());
export const setAlerting = (a: AlertingService | null) => { shared = a; };
