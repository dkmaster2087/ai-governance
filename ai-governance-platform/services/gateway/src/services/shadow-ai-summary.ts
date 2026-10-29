import { toolById, toolForDomain } from './ai-tools';
import { ShadowAiPolicy } from './shadow-ai-policy';

export interface ShadowEvent {
  domain: string;
  timestamp: string;
  userId?: string;
  blocked?: boolean;
}

export interface ShadowAiSummary {
  from: string;
  to: string;
  mode: ShadowAiPolicy['mode'];
  /** How long events are kept; trends need the previous period to fall inside it. */
  retentionDays: number;
  totals: { people: number; visits: number; blockedVisits: number };
  tools: Array<{
    id: string;
    name: string;
    domains: string[];
    visits: number;
    people: number;
    blockedVisits: number;
    /** Visits in the equally long period before; null when that period is older than retention. */
    previousVisits: number | null;
    decision: 'blocked' | 'allowed' | 'undecided';
  }>;
  people: Array<{ user: string; visits: number; tools: string[] }>;
}

export const SHADOW_RETENTION_DAYS = 30;

export function summarizeShadowAi(
  events: ShadowEvent[],
  policy: ShadowAiPolicy,
  range: { from: string; to: string; now?: Date }
): ShadowAiSummary {
  const fromMs = Date.parse(range.from);
  const toMs = Date.parse(range.to);
  const prevFromMs = fromMs - (toMs - fromMs);
  const retentionStart = (range.now ?? new Date()).getTime() - SHADOW_RETENTION_DAYS * 86_400_000;
  const prevAvailable = prevFromMs >= retentionStart;

  const inRange = events.filter((e) => { const t = Date.parse(e.timestamp); return t >= fromMs && t <= toMs; });
  const inPrev = events.filter((e) => { const t = Date.parse(e.timestamp); return t >= prevFromMs && t < fromMs; });

  type Acc = { visits: number; blocked: number; people: Set<string>; prev: number };
  const byTool = new Map<string, Acc>();
  const acc = (id: string) => byTool.get(id) ?? byTool.set(id, { visits: 0, blocked: 0, people: new Set(), prev: 0 }).get(id)!;

  const byPerson = new Map<string, { visits: number; tools: Set<string> }>();
  for (const e of inRange) {
    const tool = toolForDomain(e.domain);
    const a = acc(tool.id);
    a.visits++;
    if (e.blocked) a.blocked++;
    const who = e.userId || 'unknown';
    a.people.add(who);
    const p = byPerson.get(who) ?? byPerson.set(who, { visits: 0, tools: new Set() }).get(who)!;
    p.visits++;
    p.tools.add(tool.name);
  }
  for (const e of inPrev) acc(toolForDomain(e.domain).id).prev++;
  // Decided tools stay listed even with no visits, so decisions remain visible and reversible.
  for (const id of Object.keys(policy.decisions)) acc(id);

  const tools = [...byTool.entries()]
    .filter(([id, a]) => a.visits > 0 || policy.decisions[id])
    .map(([id, a]) => {
      const tool = toolById(id) ?? toolForDomain(id);
      return {
        id,
        name: tool.name,
        domains: tool.domains,
        visits: a.visits,
        people: a.people.size,
        blockedVisits: a.blocked,
        previousVisits: prevAvailable ? a.prev : null,
        decision: policy.decisions[id] ?? ('undecided' as const),
      };
    })
    .sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));

  const people = [...byPerson.entries()]
    .map(([user, p]) => ({ user, visits: p.visits, tools: [...p.tools] }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 8);

  return {
    from: range.from,
    to: range.to,
    mode: policy.mode,
    retentionDays: SHADOW_RETENTION_DAYS,
    totals: { people: byPerson.size, visits: inRange.length, blockedVisits: inRange.filter((e) => e.blocked).length },
    tools,
    people,
  };
}
