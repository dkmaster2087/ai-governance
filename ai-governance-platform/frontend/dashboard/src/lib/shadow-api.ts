import { createApiClient } from './http';
import { RangeKey, rangeStart } from './gateway-api';

const gateway = createApiClient('/api');

export type ToolDecision = 'blocked' | 'allowed' | 'undecided';

/** Mirrors ShadowAiSummary in services/gateway/src/services/shadow-ai-summary.ts. */
export interface ShadowAiSummary {
  from: string;
  to: string;
  mode: 'monitor' | 'block';
  retentionDays: number;
  totals: { people: number; visits: number; blockedVisits: number };
  tools: Array<{
    id: string;
    name: string;
    domains: string[];
    visits: number;
    people: number;
    blockedVisits: number;
    previousVisits: number | null;
    decision: ToolDecision;
  }>;
  people: Array<{ user: string; visits: number; tools: string[] }>;
}

export async function fetchShadowSummary(range: RangeKey): Promise<ShadowAiSummary> {
  const to = new Date();
  const { data } = await gateway.get<ShadowAiSummary>('/v1/shadow-ai/summary', {
    params: { from: rangeStart(range, to).toISOString(), to: to.toISOString() },
  });
  return data;
}

/** Change the mode for undecided tools and/or decisions; a null decision clears it. */
export async function updateShadowPolicy(change: {
  mode?: 'monitor' | 'block';
  decisions?: Record<string, 'blocked' | 'allowed' | null>;
}) {
  const { data } = await gateway.put('/v1/shadow-ai/policy', change);
  return data;
}
