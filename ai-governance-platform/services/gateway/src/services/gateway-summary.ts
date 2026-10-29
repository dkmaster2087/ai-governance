import { AuditLog } from '@ai-governance/types';

/** What happened to AI traffic in a time range, shaped for the dashboard's pipeline view. */
export interface GatewaySummary {
  from: string;
  to: string;
  /** True when the range held more records than were read; numbers are then lower bounds. */
  truncated: boolean;
  received: number;
  stopped: number;
  cleaned: number;
  delivered: number;
  sources: Array<{ name: string; count: number }>;
  checks: {
    policy: { stopped: number };
    /** Secrets detection isn't built yet; the dashboard shows this check as not active. */
    secrets: { active: boolean; stopped: number };
    personalData: { cleaned: number };
  };
  providers: Array<{ name: string; count: number }>;
  /** Most common reasons requests were stopped. */
  topStopReasons: Array<{ reason: string; count: number }>;
  /** Newest events first. */
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

const PROVIDER_NAMES: Record<string, string> = {
  bedrock: 'Amazon Bedrock',
  openai: 'OpenAI',
  anthropic: 'Anthropic API',
  'azure-openai': 'Azure OpenAI',
  'google-vertex': 'Google Vertex',
  cohere: 'Cohere',
  mistral: 'Mistral',
};

const MAX_SOURCES = 6;

function countBy<T>(items: T[], key: (item: T) => string): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function isStopped(log: AuditLog): boolean {
  return log.eventType === 'request_blocked';
}

function stopReason(log: AuditLog): string {
  return log.metadata?.policyReason || log.triggeredRules?.[0] || 'Blocked by policy';
}

export function summarizeGatewayTraffic(
  logs: AuditLog[],
  range: { from: string; to: string; truncated?: boolean },
  shadowEvents: Array<{ userId?: string }> = []
): GatewaySummary {
  const stoppedLogs = logs.filter(isStopped);
  const deliveredLogs = logs.filter((l) => !isStopped(l));
  const cleaned = deliveredLogs.filter((l) => l.piiDetected).length;
  // Every stop today comes from the policy engine; secrets detection will add its own check later.
  const secretsStopped = stoppedLogs.filter((l) => l.metadata?.check === 'secrets').length;
  const policyStopped = stoppedLogs.length - secretsStopped;

  const allSources = countBy(logs, (l) => l.appId || 'unknown');
  const sources = allSources.slice(0, MAX_SOURCES);
  const rest = allSources.slice(MAX_SOURCES).reduce((sum, s) => sum + s.count, 0);
  const others = allSources.length - MAX_SOURCES;
  if (rest > 0) sources.push({ name: `${others} other ${others === 1 ? 'app' : 'apps'}`, count: rest });

  const recent = [...logs]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 8)
    .map((l) => ({
      time: l.timestamp,
      outcome: isStopped(l) ? ('stopped' as const) : l.piiDetected ? ('cleaned' as const) : ('delivered' as const),
      app: l.appId || 'unknown',
      user: l.userId || 'anonymous',
      model: l.modelId,
      ...(isStopped(l) ? { reason: stopReason(l) } : {}),
    }));

  return {
    from: range.from,
    to: range.to,
    truncated: range.truncated ?? false,
    received: logs.length,
    stopped: stoppedLogs.length,
    cleaned,
    delivered: deliveredLogs.length,
    sources,
    checks: {
      policy: { stopped: policyStopped },
      secrets: { active: false, stopped: secretsStopped },
      personalData: { cleaned },
    },
    providers: countBy(deliveredLogs, (l) => PROVIDER_NAMES[l.provider] ?? l.provider ?? 'unknown'),
    topStopReasons: countBy(stoppedLogs, stopReason).slice(0, 3).map(({ name, count }) => ({ reason: name, count })),
    recent,
    shadowAi: {
      people: new Set(shadowEvents.map((e) => e.userId || 'unknown')).size,
      visits: shadowEvents.length,
    },
  };
}
