import { AuditLog } from '@ai-governance/types';

export interface StoppedCause {
  /** Stable grouping key: the rule that stopped the request. */
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
}

export interface StoppedSummary {
  from: string;
  to: string;
  truncated: boolean;
  total: number;
  byCheck: { policy: number; secrets: { active: boolean; stopped: number } };
  /** One entry per calendar day in the viewer's timezone, oldest first. */
  byDay: Array<{ date: string; count: number }>;
  causes: StoppedCause[];
}

const DAY_MS = 86_400_000;

/** YYYY-MM-DD for a timestamp in a timezone given as JS getTimezoneOffset() minutes. */
export function localDate(iso: string, tzOffsetMinutes: number): string {
  return new Date(new Date(iso).getTime() - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function top(counts: Map<string, number>, n: number): Array<{ name: string; count: number }> {
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, n);
}

export function summarizeStopped(
  logs: AuditLog[],
  range: { from: string; to: string; truncated?: boolean; tzOffsetMinutes?: number }
): StoppedSummary {
  const tz = range.tzOffsetMinutes ?? 0;
  const stopped = logs
    .filter((l) => l.eventType === 'request_blocked')
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Every calendar day in range, so quiet days show as zero.
  const byDayMap = new Map<string, number>();
  const firstDay = localDate(range.from, tz);
  const lastDay = localDate(range.to, tz);
  for (let t = Date.parse(firstDay + 'T00:00:00Z'); ; t += DAY_MS) {
    const d = new Date(t).toISOString().slice(0, 10);
    byDayMap.set(d, 0);
    if (d >= lastDay || byDayMap.size > 40) break;
  }
  for (const l of stopped) {
    const d = localDate(l.timestamp, tz);
    if (byDayMap.has(d)) byDayMap.set(d, (byDayMap.get(d) ?? 0) + 1);
  }

  const groups = new Map<string, AuditLog[]>();
  for (const l of stopped) {
    const key = l.triggeredRules?.[0] || l.metadata?.policyReason || 'unknown';
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }

  const causes: StoppedCause[] = [...groups.entries()].map(([key, items]): StoppedCause => {
    const latest = items[0];
    // Older records may lack the readable reason; use the newest one that has it.
    const reason = items.find((i) => i.metadata?.policyReason)?.metadata.policyReason ?? key;
    const withEvidence = items.find((i) => i.metadata?.evidenceHit);
    const apps = new Map<string, number>();
    const people = new Map<string, number>();
    for (const i of items) {
      apps.set(i.appId || 'unknown', (apps.get(i.appId || 'unknown') ?? 0) + 1);
      const who = i.userId || 'anonymous';
      people.set(who, (people.get(who) ?? 0) + 1);
    }
    const ruleType = withEvidence?.metadata.ruleType ?? latest.metadata?.ruleType;
    return {
      key,
      reason,
      ruleType,
      check: latest.metadata?.check === 'secrets' ? 'secrets' : 'policy',
      count: items.length,
      apps: top(apps, 3),
      people: people.size,
      topPeople: top(people, 3).map((p) => p.name),
      latest: {
        time: (withEvidence ?? latest).timestamp,
        app: (withEvidence ?? latest).appId || 'unknown',
        user: (withEvidence ?? latest).userId || 'anonymous',
        model: (withEvidence ?? latest).modelId,
        ...(withEvidence
          ? { evidence: { before: withEvidence.metadata.evidenceBefore ?? '', hit: withEvidence.metadata.evidenceHit, after: withEvidence.metadata.evidenceAfter ?? '' } }
          : {}),
      },
    };
  }).sort((a, b) => b.count - a.count);

  const secrets = stopped.filter((l) => l.metadata?.check === 'secrets').length;
  return {
    from: range.from,
    to: range.to,
    truncated: range.truncated ?? false,
    total: stopped.length,
    byCheck: { policy: stopped.length - secrets, secrets: { active: false, stopped: secrets } },
    byDay: [...byDayMap.entries()].map(([date, count]) => ({ date, count })),
    causes,
  };
}
