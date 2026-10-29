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

export const RANGE_LABELS: Record<RangeKey, { button: string; phrase: string }> = {
  today: { button: 'Today', phrase: 'Today' },
  week: { button: 'This week', phrase: 'In the last 7 days' },
  month: { button: 'This month', phrase: 'In the last 30 days' },
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
