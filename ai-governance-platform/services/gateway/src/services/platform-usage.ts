import { AuditLog } from '@ai-governance/types';

/** One tenant's AI traffic in a period, for the platform-admin views. */
export interface TenantUsage {
  tenantId: string;
  requests: number;
  stopped: number;
  cleaned: number;
  cost: number;
  lastRequestAt: string | null;
  /** True when the period held more records than were read; numbers are then lower bounds. */
  truncated: boolean;
  models: Array<{ model: string; requests: number; cost: number }>;
}

export interface PlatformUsage {
  from: string;
  to: string;
  totals: { requests: number; stopped: number; cleaned: number; cost: number };
  /** Per day across all tenants, oldest first, in the viewer's timezone. */
  days: Array<{ date: string; requests: number; stopped: number }>;
  tenants: TenantUsage[];
  truncated: boolean;
}

const isStopped = (l: AuditLog) => l.eventType === 'request_blocked';

/** YYYY-MM-DD for a timestamp, shifted by a JS getTimezoneOffset() value. */
export function localDate(iso: string, tzOffsetMinutes: number): string {
  return new Date(new Date(iso).getTime() - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function summarizeTenant(tenantId: string, logs: AuditLog[], truncated: boolean): TenantUsage {
  const models = new Map<string, { requests: number; cost: number }>();
  let stopped = 0, cleaned = 0, cost = 0;
  let last: string | null = null;
  for (const l of logs) {
    if (isStopped(l)) stopped++;
    else if (l.piiDetected) cleaned++;
    cost += l.estimatedCost || 0;
    if (!last || l.timestamp > last) last = l.timestamp;
    const m = models.get(l.modelId || 'unknown') ?? { requests: 0, cost: 0 };
    m.requests++; m.cost += l.estimatedCost || 0;
    models.set(l.modelId || 'unknown', m);
  }
  return {
    tenantId, requests: logs.length, stopped, cleaned, cost, lastRequestAt: last, truncated,
    models: [...models.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.requests - a.requests),
  };
}

export function summarizePlatform(
  perTenant: Array<{ tenantId: string; logs: AuditLog[]; truncated: boolean }>,
  range: { from: string; to: string; tz: number }
): PlatformUsage {
  const days = new Map<string, { requests: number; stopped: number }>();
  // Every day in the range appears, so quiet days show as zero rather than vanishing.
  for (let t = new Date(range.from).getTime(); t <= new Date(range.to).getTime(); t += 86_400_000) {
    days.set(localDate(new Date(t).toISOString(), range.tz), { requests: 0, stopped: 0 });
  }
  const lastDay = localDate(range.to, range.tz);
  if (!days.has(lastDay)) days.set(lastDay, { requests: 0, stopped: 0 });
  for (const { logs } of perTenant) {
    for (const l of logs) {
      const d = days.get(localDate(l.timestamp, range.tz));
      if (!d) continue;
      d.requests++;
      if (isStopped(l)) d.stopped++;
    }
  }
  const tenants = perTenant.map((t) => summarizeTenant(t.tenantId, t.logs, t.truncated)).sort((a, b) => b.requests - a.requests);
  return {
    from: range.from,
    to: range.to,
    totals: tenants.reduce((s, t) => ({
      requests: s.requests + t.requests, stopped: s.stopped + t.stopped, cleaned: s.cleaned + t.cleaned, cost: s.cost + t.cost,
    }), { requests: 0, stopped: 0, cleaned: 0, cost: 0 }),
    days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    tenants,
    truncated: tenants.some((t) => t.truncated),
  };
}
