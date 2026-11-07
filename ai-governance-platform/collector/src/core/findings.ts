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
  zscaler: 'Zscaler Internet Access web logs',
  netskope: 'Netskope events',
  syslog_leef: 'Security device logs (LEEF)',
  azure_firewall: 'Azure Firewall application rule logs',
  azure_dns: 'Azure DNS query logs',
  azure_openai: 'Azure OpenAI / AI Foundry request logs',
  gcp_dns: 'Google Cloud DNS query logs',
  gcp_web_proxy: 'Google Cloud Secure Web Proxy logs',
  gcp_audit: 'Google Cloud audit logs (Vertex AI, Gemini API)',
  m365_audit: 'Microsoft 365 audit log (Copilot and AI apps)',
  gws_gemini: 'Google Workspace: Gemini activity',
  gws_oauth: 'Google Workspace: apps given access to Google data',
  gws_sso: 'Google Workspace: single sign-on',
  okta_sso: 'Okta: single sign-on',
  okta_consent: 'Okta: OAuth consent',
  entra_signin: 'Microsoft Entra ID sign-ins',
  entra_consent: 'Microsoft Entra ID: consent to applications',
  idp_signin: 'Identity provider sign-ins',
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
  zscaler: 'Shows web traffic sent through Zscaler, in the office and away from it; traffic set to bypass Zscaler isn’t seen.',
  netskope: 'Shows traffic sent through Netskope, in the office and away from it; traffic set to bypass Netskope isn’t seen.',
  syslog_leef: 'Shows what the sending device logged with a destination name.',
  azure_firewall: 'Shows outgoing connections the firewall’s application rules handled; traffic that doesn’t pass the firewall isn’t seen.',
  azure_dns: 'Shows lookups through the firewall’s DNS proxy or a DNS security policy; resources using other resolvers aren’t seen.',
  azure_openai: 'Shows model calls to Azure OpenAI and AI Foundry resources with diagnostic logs turned on; key-based calls are identified by IP address only.',
  gcp_dns: 'Shows lookups from VMs in networks with Cloud DNS logging turned on.',
  gcp_web_proxy: 'Shows web traffic sent through Secure Web Proxy only.',
  gcp_audit: 'Shows model calls only where Data Access audit logs are turned on for Vertex AI and the Gemini API.',
  m365_audit: 'Shows Copilot use, and other AI apps only where Purview watches them; needs auditing turned on.',
  gws_gemini: 'Shows Gemini use inside Workspace apps that the Reports API records.',
  gws_oauth: 'Shows when someone let an AI app reach their Google data; not how much it read afterwards.',
  gws_sso: 'Shows sign-ins to AI apps that use Google Workspace as their identity provider.',
  okta_sso: 'Shows sign-ins to AI apps set up in Okta; personal accounts on the same services aren’t seen.',
  okta_consent: 'Shows when someone granted an AI app access through Okta.',
  entra_signin: 'Shows sign-ins to AI apps that use Entra ID; personal accounts on the same services aren’t seen.',
  entra_consent: 'Shows when someone let an AI app reach company data in Microsoft 365.',
  idp_signin: 'Shows sign-ins to AI apps the identity provider handles; app names are matched to the catalog.',
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

/** A way AI traffic leaves the company that Probaline can carry. Browsers are the extension's job, not a path here. */
export type PathId = 'model_api' | 'cloud_ai';

export const PATH_TITLES: Record<PathId, string> = {
  model_api: 'Apps calling model APIs',
  cloud_ai: 'Cloud AI services (Bedrock, SageMaker, Azure OpenAI, Vertex AI)',
};

/** One log source's view of a path. Through and direct are in that source's own units, so the share is honest. */
export interface PathSource {
  source: string;
  label: string;
  through: number;
  direct: number;
  /** through / (through + direct). */
  share: number;
}

export interface StillDirect {
  who: string;
  services: string[];
  count: number;
  sources: string[];
  /** What to change so this caller goes through Probaline. */
  fix: string;
}

export interface PathFinding {
  id: PathId;
  title: string;
  /**
   * The share through Probaline, from the source that saw the most of this path among those that saw the
   * gateway (or the most overall when none did). Null when nothing was seen on this path.
   */
  share: number | null;
  through: number;
  direct: number;
  /** The source the headline share comes from. */
  measuredBy: string;
  /** Whether any source saw the gateway on this path; when not, the share may be 0% only because `--gateway` is missing. */
  gatewaySeen: boolean;
  sources: PathSource[];
  stillDirect: StillDirect[];
  /** Callers still going direct, including those beyond the list. */
  stillDirectCount: number;
}

/** Shares from earlier findings files in the same results folder, oldest first. */
export interface ShareHistoryEntry {
  to: string;
  shares: Partial<Record<PathId, number>>;
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
  /** Share of direct model-API traffic covered by routing the top callers through Probaline. */
  coverage: { callers: number; share: number } | null;
  /** The share through Probaline, per path. Traffic counted here is left out of every other section. */
  paths: PathFinding[];
  /** Added by buildReport from earlier findings files; absent when there are none. */
  history?: ShareHistoryEntry[];
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
export const STILL_DIRECT_LISTED = 50;

const pathOf = (r: Sighting): PathId | null => (r.kind === 'api' ? 'model_api' : r.kind === 'cloud_ai' ? 'cloud_ai' : null);

function fixFor(path: PathId, who: string): string {
  if (path === 'model_api') {
    return isPerson(who)
      ? 'Give this person a Probaline API key, or the approved chat tool, instead of their own provider key.'
      : 'Change the app’s AI base address to the Probaline gateway and give it a Probaline API key.';
  }
  return isPerson(who)
    ? 'Use the gateway instead of calling models with personal cloud credentials.'
    : 'Point the workload at the gateway, then limit direct model access to the gateway’s role.';
}

/** Through vs direct, per path and source, and who is still going direct. */
export function buildPaths(rows: Sighting[]): PathFinding[] {
  const out: PathFinding[] = [];
  for (const id of ['model_api', 'cloud_ai'] as PathId[]) {
    const rs = rows.filter((r) => pathOf(r) === id);
    if (rs.length === 0) continue;
    const bySource = new Map<string, { through: number; direct: number }>();
    for (const r of rs) {
      const c = bySource.get(r.source) ?? { through: 0, direct: 0 };
      if (r.via === 'probaline') c.through += r.count; else c.direct += r.count;
      bySource.set(r.source, c);
    }
    const sources: PathSource[] = [...bySource.entries()]
      .map(([source, c]) => ({ source, label: SOURCE_LABELS[source] ?? source, ...c, share: c.through / (c.through + c.direct) }))
      .sort((a, b) => b.through + b.direct - (a.through + a.direct));
    const gatewaySeen = sources.some((x) => x.through > 0);
    const primary = sources.find((x) => !gatewaySeen || x.through > 0)!;

    const direct = new Map<string, { services: Set<string>; count: number; sources: Set<string> }>();
    for (const r of rs.filter((x) => x.via !== 'probaline')) {
      const c = direct.get(r.who) ?? { services: new Set<string>(), count: 0, sources: new Set<string>() };
      c.services.add(nameOf(r.service));
      c.sources.add(SOURCE_LABELS[r.source] ?? r.source);
      c.count += r.count;
      direct.set(r.who, c);
    }
    const stillDirect = [...direct.entries()]
      .map(([who, c]) => ({ who, services: [...c.services].sort(), count: c.count, sources: [...c.sources].sort(), fix: fixFor(id, who) }))
      .sort((a, b) => b.count - a.count);

    out.push({
      id,
      title: PATH_TITLES[id],
      share: primary.share,
      through: primary.through,
      direct: primary.direct,
      measuredBy: primary.label,
      gatewaySeen,
      sources,
      stillDirect: stillDirect.slice(0, STILL_DIRECT_LISTED),
      stillDirectCount: stillDirect.length,
    });
  }
  return out;
}

/** Everything the report says, from the sightings in a period. */
export function buildFindings(allRows: Sighting[], from: string, to: string, now = new Date()): Findings {
  // Traffic through Probaline is reported once, in `paths`; everything else describes use outside it.
  const rows = allRows.filter((r) => r.via !== 'probaline');
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
  for (const r of allRows) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
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
    paths: buildPaths(allRows),
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
      title: `Route ${plural(f.directApi.length, 'server or app', 'servers and apps')} that call model APIs directly through Probaline`,
      why: 'Their prompts reach AI providers with no check for personal data, secrets or company rules, and no record of what was sent.',
      action: `Change each app’s AI base address to the Probaline gateway and give it a Probaline API key. It is usually one setting per app.${!f.coverage ? '' : f.coverage.callers >= f.directApi.length ? ` Routing all ${f.directApi.length} puts all direct model-API traffic under policy.` : ` Routing the top ${f.coverage.callers} alone puts ${pct(f.coverage.share)} of direct model-API traffic under policy.`}`,
      items: top.map((c) => `${c.who}: ${c.services.join(', ')}`),
    });
  }

  if (f.cloudAi.length > 0) {
    const names = [...new Set(f.cloudAi.flatMap((c) => c.services))];
    out.push({
      priority: 'high',
      title: `Put ${names.join(' and ')} behind the gateway`,
      why: `${plural(f.cloudAi.length, 'identity', 'identities')} call the cloud provider’s AI service directly, so no Probaline policy applies to those prompts.`,
      action: 'Point these workloads at the Probaline gateway, then limit direct model access in cloud permissions to the gateway’s own role.',
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
      action: 'Pick one with business terms (or an internal assistant behind Probaline), approve it, and steer people to it with the browser extension’s block page.',
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
