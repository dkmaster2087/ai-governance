import { createApiClient } from './http';

const gateway = createApiClient('/api');

/** Mirrors GatewaySummary in services/gateway/src/services/gateway-summary.ts. */
export interface GatewaySummary {
  from: string;
  to: string;
  truncated: boolean;
  received: number;
  stopped: number;
  cleaned: number;
  delivered: number;
  sources: Array<{ name: string; count: number }>;
  checks: {
    policy: { stopped: number };
    secrets: { active: boolean; stopped: number };
    personalData: { cleaned: number };
  };
  providers: Array<{ name: string; count: number }>;
  topStopReasons: Array<{ reason: string; count: number }>;
  recent: Array<{
    time: string;
    outcome: 'stopped' | 'cleaned' | 'delivered';
    app: string;
    user: string;
    model: string;
    reason?: string;
  }>;
  shadowAi: { people: number; visits: number };
}

export type RangeKey = 'today' | 'week' | 'month';

export const RANGE_LABELS: Record<RangeKey, { button: string; phrase: string; inline: string }> = {
  today: { button: 'Today', phrase: 'Today', inline: 'today' },
  week: { button: 'This week', phrase: 'In the last 7 days', inline: 'in the last 7 days' },
  month: { button: 'This month', phrase: 'In the last 30 days', inline: 'in the last 30 days' },
};

/** Start of the range in the viewer's local time. */
export function rangeStart(range: RangeKey, now = new Date()): Date {
  if (range === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return new Date(now.getTime() - (range === 'week' ? 7 : 30) * 86_400_000);
}

export async function fetchGatewaySummary(range: RangeKey): Promise<GatewaySummary> {
  const to = new Date();
  const { data } = await gateway.get<GatewaySummary>('/v1/gateway/summary', {
    params: { from: rangeStart(range, to).toISOString(), to: to.toISOString() },
  });
  return data;
}

/** Mirrors StoppedSummary in services/gateway/src/services/stopped-summary.ts. */
export interface StoppedSummary {
  from: string;
  to: string;
  truncated: boolean;
  total: number;
  byCheck: { policy: number; secrets: { active: boolean; stopped: number } };
  byDay: Array<{ date: string; count: number }>;
  causes: Array<{
    key: string;
    reason: string;
    ruleType?: string;
    check: 'policy' | 'secrets';
    count: number;
    apps: Array<{ name: string; count: number }>;
    people: number;
    topPeople: string[];
    latest: {
      time: string;
      app: string;
      user: string;
      model: string;
      evidence?: { before: string; hit: string; after: string };
    };
  }>;
}

export async function fetchStopped(range: RangeKey): Promise<StoppedSummary> {
  const to = new Date();
  const { data } = await gateway.get<StoppedSummary>('/v1/gateway/stopped', {
    params: { from: rangeStart(range, to).toISOString(), to: to.toISOString(), tz: to.getTimezoneOffset() },
  });
  return data;
}
