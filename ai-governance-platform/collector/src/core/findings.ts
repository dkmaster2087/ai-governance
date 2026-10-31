import { CATALOG_VERSION, Category, serviceById } from './catalog';
import { Kind, Sighting } from './sightings';

export const SOURCE_LABELS: Record<string, string> = {
  aws_dns: 'AWS Route 53 Resolver DNS query logs',
  aws_firewall: 'AWS Network Firewall logs',
  aws_cloudtrail: 'AWS CloudTrail',
  syslog_paloalto: 'Palo Alto Networks URL filtering logs',
  syslog_fortinet: 'Fortinet FortiGate logs',
  syslog_cef: 'Security device logs (CEF)',
  squid: 'Squid proxy access logs',
  bind_dns: 'BIND DNS query logs',
  windows_dns: 'Windows DNS server debug logs',
};

/** What each source can't see, said plainly in the report. */
const SOURCE_LIMITS: Record<string, string> = {
  aws_dns: 'Shows which servers looked up an AI service, not how much they sent. Lookups are cached, so counts understate real traffic.',
  aws_firewall: 'Shows outgoing connections by name; traffic that doesn’t pass the firewall isn’t seen.',
  aws_cloudtrail: 'Shows calls to Amazon Bedrock and SageMaker that CloudTrail records; model calls may need data events turned on for the trail.',
  syslog_paloalto: 'Shows sites the firewall’s URL filtering logged; sites in categories set not to log aren’t seen.',
  syslog_fortinet: 'Shows web filter and DNS events the FortiGate logged; traffic the policy doesn’t log isn’t seen.',
  syslog_cef: 'Shows what the sending device logged with a destination name.',
  squid: 'Shows web traffic through this proxy only.',
  bind_dns: 'Shows lookups through this DNS server; devices using other resolvers or encrypted DNS aren’t seen.',
  windows_dns: 'Shows lookups through this DNS server; devices using other resolvers or encrypted DNS aren’t seen.',
};

export const isPerson = (who: string) => who.startsWith('user-');

export interface ServiceFinding {
  id: string;
  name: string;
  vendor: string;
  category: Category;
  businessTerms: 'offered' | 'unknown';
  kinds: Kind[];
  count: number;
  people: number;
  machines: number;
  days: number;
  /** Counts in the first and second half of the period. */
  trend: { first: number; second: number };
}

export interface CallerFinding {
  who: string;
  services: string[];
  count: number;
  bytesOut?: number;
}

export interface Recommendation {
  priority: 'high' | 'medium' | 'low';
  title: string;
  why: string;
  action: string;
  items: string[];
}

export interface Findings {
  from: string;
  to: string;
  generatedAt: string;
  catalogVersion: string;
  totals: { services: number; people: number; machines: number; count: number; noTermsServices: number };
  services: ServiceFinding[];
  directApi: CallerFinding[];
  cloudAi: CallerFinding[];
  browser: Array<{ service: string; people: number; machines: number; count: number }>;
  sources: Array<{ source: string; label: string; firstDay: string; lastDay: string; days: number; count: number; limits?: string }>;
  /** Share of direct model-API traffic covered by routing the top callers through Aegis. */
  coverage: { callers: number; share: number } | null;
  recommendations: Recommendation[];
}

const nameOf = (id: string) => serviceById(id)?.name ?? id;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function callers(rows: Sighting[]): CallerFinding[] {
  const map = new Map<string, { services: Set<string>; count: number; bytesOut?: number }>();
  for (const r of rows) {
    const c = map.get(r.who) ?? { services: new Set<string>(), count: 0 };
    c.services.add(nameOf(r.service));
    c.count += r.count;
    if (r.bytesOut !== undefined) c.bytesOut = (c.bytesOut ?? 0) + r.bytesOut;
    map.set(r.who, c);
  }
  return [...map.entries()]
    .map(([who, c]) => ({ who, services: [...c.services].sort(), count: c.count, ...(c.bytesOut !== undefined ? { bytesOut: c.bytesOut } : {}) }))
    .sort((a, b) => b.count - a.count);
}

export const TOP_CALLERS = 10;

/** Everything the report says, from the sightings in a period. */
export function buildFindings(rows: Sighting[], from: string, to: string, now = new Date()): Findings {
  const mid = new Date((new Date(from).getTime() + new Date(to).getTime()) / 2).toISOString().slice(0, 10);

  const bySvc = new Map<string, Sighting[]>();
  for (const r of rows) bySvc.set(r.service, [...(bySvc.get(r.service) ?? []), r]);
  const services: ServiceFinding[] = [...bySvc.entries()].map(([id, rs]) => {
    const s = serviceById(id);
    const who = new Set(rs.map((r) => r.who));
    return {
      id,
      name: s?.name ?? id,
      vendor: s?.vendor ?? 'Unknown',
      category: s?.category ?? 'chat',
      businessTerms: s?.businessTerms ?? 'unknown',
      kinds: [...new Set(rs.map((r) => r.kind))].sort(),
      count: sum(rs.map((r) => r.count)),
      people: [...who].filter(isPerson).length,
      machines: [...who].filter((w) => !isPerson(w)).length,
      days: new Set(rs.map((r) => r.day)).size,
      trend: { first: sum(rs.filter((r) => r.day < mid).map((r) => r.count)), second: sum(rs.filter((r) => r.day >= mid).map((r) => r.count)) },
    };
  }).sort((a, b) => b.count - a.count);

  const directApi = callers(rows.filter((r) => r.kind === 'api' && !isPerson(r.who)));
  const cloudAi = callers(rows.filter((r) => r.kind === 'cloud_ai'));
  const browser = services
    .filter((s) => s.kinds.includes('browser'))
    .map((s) => {
      const rs = (bySvc.get(s.id) ?? []).filter((r) => r.kind === 'browser');
      const who = new Set(rs.map((r) => r.who));
      return { service: s.name, people: [...who].filter(isPerson).length, machines: [...who].filter((w) => !isPerson(w)).length, count: sum(rs.map((r) => r.count)) };
    })
    .sort((a, b) => b.people + b.machines - (a.people + a.machines));

  const bySource = new Map<string, Sighting[]>();
  for (const r of rows) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
  const sources = [...bySource.entries()].map(([source, rs]) => {
    const days = [...new Set(rs.map((r) => r.day))].sort();
    return { source, label: SOURCE_LABELS[source] ?? source, firstDay: days[0], lastDay: days[days.length - 1], days: days.length, count: sum(rs.map((r) => r.count)), limits: SOURCE_LIMITS[source] };
  }).sort((a, b) => a.label.localeCompare(b.label));

  const apiTotal = sum(directApi.map((c) => c.count));
  const coverage = apiTotal > 0
    ? { callers: Math.min(TOP_CALLERS, directApi.length), share: sum(directApi.slice(0, TOP_CALLERS).map((c) => c.count)) / apiTotal }
    : null;

  const allWho = new Set(rows.map((r) => r.who));
  const findings: Findings = {
    from, to,
    generatedAt: now.toISOString(),
    catalogVersion: CATALOG_VERSION,
    totals: {
      services: services.length,
      people: [...allWho].filter(isPerson).length,
      machines: [...allWho].filter((w) => !isPerson(w)).length,
      count: sum(rows.map((r) => r.count)),
      noTermsServices: services.filter((s) => s.businessTerms === 'unknown').length,
    },
    services, directApi, cloudAi, browser, sources, coverage,
    recommendations: [],
  };
  findings.recommendations = recommend(findings);
  return findings;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One concrete action per kind of finding, most important first. */
export function recommend(f: Findings): Recommendation[] {
  const out: Recommendation[] = [];

  if (f.directApi.length > 0) {
    const top = f.directApi.slice(0, TOP_CALLERS);
    out.push({
      priority: 'high',
      title: `Route ${plural(f.directApi.length, 'server or app', 'servers and apps')} that call model APIs directly through Aegis`,
      why: 'Their prompts reach AI providers with no check for personal data, secrets or company rules, and no record of what was sent.',
      action: `Change each app’s AI base address to the Aegis gateway and give it an Aegis API key. It is usually one setting per app.${!f.coverage ? '' : f.coverage.callers >= f.directApi.length ? ` Routing all ${f.directApi.length} puts all direct model-API traffic under policy.` : ` Routing the top ${f.coverage.callers} alone puts ${pct(f.coverage.share)} of direct model-API traffic under policy.`}`,
      items: top.map((c) => `${c.who}: ${c.services.join(', ')}`),
    });
  }

  if (f.cloudAi.length > 0) {
    const names = [...new Set(f.cloudAi.flatMap((c) => c.services))];
    out.push({
      priority: 'high',
      title: `Put ${names.join(' and ')} behind the gateway`,
      why: `${plural(f.cloudAi.length, 'identity', 'identities')} call the cloud provider’s AI service directly, so no Aegis policy applies to those prompts.`,
      action: 'Point these workloads at the Aegis gateway, then limit direct model access in cloud permissions to the gateway’s own role.',
      items: f.cloudAi.slice(0, TOP_CALLERS).map((c) => `${c.who}: ${c.services.join(', ')}`),
    });
  }

  const noTerms = f.services.filter((s) => s.businessTerms === 'unknown');
  if (noTerms.length > 0) {
    out.push({
      priority: 'medium',
      title: `Block ${plural(noTerms.length, 'AI service')} with no business data terms on record`,
      why: 'We have no record of these vendors offering terms that keep company data out of model training.',
      action: 'Block them in the browser extension or your web gateway, and say which approved tool to use instead.',
      items: noTerms.map((s) => `${s.name} (${s.vendor}): ${plural(s.people + s.machines, 'user or device', 'users or devices')}`),
    });
  }

  const chats = f.services.filter((s) => s.category === 'chat');
  if (chats.length > 1) {
    out.push({
      priority: 'medium',
      title: `Approve one chat assistant; ${chats.length} are in use`,
      why: 'People are spread across several consumer AI tools, each with its own data handling and no shared policy.',
      action: 'Pick one with business terms (or an internal assistant behind Aegis), approve it, and steer people to it with the browser extension’s block page.',
      items: chats.map((s) => s.name),
    });
  }

  const workApps = f.services.filter((s) => s.category === 'work_app');
  if (workApps.length > 0) {
    out.push({
      priority: 'low',
      title: 'Confirm data settings for AI inside work apps',
      why: 'These are often already licensed; their admin settings decide what data the AI can see.',
      action: 'Review each vendor’s admin console for data sharing and retention.',
      items: workApps.map((s) => s.name),
    });
  }

  if (f.sources.some((s) => s.source.startsWith('aws_')) && !f.sources.some((s) => s.source === 'aws_cloudtrail')) {
    out.push({
      priority: 'low',
      title: 'Add CloudTrail to see direct use of Amazon Bedrock',
      why: 'DNS and firewall logs show that something contacted Bedrock, but not which identity or how often.',
      action: 'Point the collector at the CloudTrail bucket too.',
      items: [],
    });
  }

  return out;
}
