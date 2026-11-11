import { CATALOG, CATALOG_VERSION, Category, serviceById } from '@ai-governance/catalog';

/**
 * The AI-domain feed: catalog domains a firewall, web gateway or DNS server fetches and blocks, with the rule
 * "block, except from the gateway's egress addresses". Only public domain names are in it.
 */

export const FEED_CATEGORIES: Array<{ id: Category; label: string; hint: string }> = [
  { id: 'model_api', label: 'Model APIs', hint: 'OpenAI, Anthropic, Gemini and other APIs apps call. The gateway still reaches them from its own addresses.' },
  { id: 'chat', label: 'Chat apps', hint: 'ChatGPT, Claude, Gemini, Perplexity and others people open in a browser.' },
  { id: 'coding', label: 'Coding assistants', hint: 'GitHub Copilot, Cursor, Windsurf, Tabnine, Replit.' },
  { id: 'cloud_ai', label: 'Cloud AI endpoints', hint: 'Azure OpenAI and AI Foundry, Vertex AI. Bedrock and SageMaker are locked in AWS instead.' },
  { id: 'work_app', label: 'AI in work apps', hint: 'Meeting notetakers, writing assistants. Often licensed: check before blocking.' },
];
export const DEFAULT_FEED_CATEGORIES: Category[] = ['model_api', 'chat'];

export type FeedFormat = 'domains' | 'zscaler' | 'netskope' | 'rpz' | 'hosts';
export const FEED_FORMATS: FeedFormat[] = ['domains', 'zscaler', 'netskope', 'rpz', 'hosts'];

/** One blocked name: the domain itself and/or every subdomain of it. */
export interface FeedEntry {
  domain: string;
  exact: boolean;
  subdomains: boolean;
  service: string;
}

/** Catalog domains in these categories, minus approved tools. Sorted, one entry per domain. */
export function feedEntries(categories: Category[], approvedIds: string[] = []): FeedEntry[] {
  const wanted = new Set(categories);
  const approved = new Set(approvedIds.map((id) => serviceById(id)?.id ?? id));
  const byDomain = new Map<string, FeedEntry>();
  for (const s of CATALOG) {
    if (!wanted.has(s.category) || approved.has(s.id)) continue;
    for (const d of s.domains) byDomain.set(d, { domain: d, exact: true, subdomains: true, service: s.id });
    for (const d of s.subdomainsOf ?? []) if (!byDomain.has(d)) byDomain.set(d, { domain: d, exact: false, subdomains: true, service: s.id });
  }
  // A domain under another listed one adds nothing: `chat.deepseek.com` is already covered by `*.deepseek.com`.
  const entries = [...byDomain.values()];
  return entries
    .filter((e) => !entries.some((o) => o !== e && o.subdomains && e.domain.endsWith(`.${o.domain}`)))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

export interface FeedMeta {
  name: string;
  generatedAt: string;
}

const comment = (prefix: string, meta: FeedMeta, count: number) => [
  `${prefix} Probaline AI-domain feed: ${meta.name.replace(/[\r\n]/g, ' ')}`,
  `${prefix} ${count} domains, catalog ${CATALOG_VERSION}, generated ${meta.generatedAt}`,
];

/** The feed in one format: body and content type. */
export function renderFeed(format: FeedFormat, entries: FeedEntry[], meta: FeedMeta): { body: string; contentType: string } {
  switch (format) {
    case 'domains':
      // No comments: Palo Alto EDLs and FortiGate threat feeds treat every line as an entry.
      return {
        body: entries.flatMap((e) => [...(e.exact ? [e.domain] : []), ...(e.subdomains ? [`*.${e.domain}`] : [])]).join('\n') + '\n',
        contentType: 'text/plain; charset=utf-8',
      };
    case 'hosts':
      return {
        body: [...comment('#', meta, entries.length), '# Hosts files can’t match subdomains; prefer the domain list or RPZ.',
          ...entries.filter((e) => e.exact).map((e) => `0.0.0.0 ${e.domain}`)].join('\n') + '\n',
        contentType: 'text/plain; charset=utf-8',
      };
    case 'rpz': {
      const serial = meta.generatedAt.slice(0, 10).replace(/-/g, '') + '00';
      return {
        body: [
          ...comment(';', meta, entries.length),
          '$TTL 300',
          `@ IN SOA localhost. hostmaster.localhost. ${serial} 3600 600 86400 300`,
          '@ IN NS localhost.',
          ...entries.flatMap((e) => [...(e.exact ? [`${e.domain} CNAME .`] : []), ...(e.subdomains ? [`*.${e.domain} CNAME .`] : [])]),
        ].join('\n') + '\n',
        contentType: 'text/plain; charset=utf-8',
      };
    }
    case 'zscaler':
      // A leading dot means the domain and every subdomain in a Zscaler custom URL category.
      return {
        body: JSON.stringify({
          configuredName: `Probaline: ${meta.name}`.slice(0, 64),
          description: `Probaline AI-domain feed, catalog ${CATALOG_VERSION}, generated ${meta.generatedAt}`,
          superCategory: 'USER_DEFINED',
          urls: entries.map((e) => `.${e.domain}`),
        }, null, 2) + '\n',
        contentType: 'application/json; charset=utf-8',
      };
    case 'netskope':
      return {
        body: JSON.stringify({
          name: `Probaline ${meta.name}`.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 64),
          data: { type: 'exact', urls: entries.flatMap((e) => [...(e.exact ? [e.domain] : []), ...(e.subdomains ? [`*.${e.domain}`] : [])]) },
        }, null, 2) + '\n',
        contentType: 'application/json; charset=utf-8',
      };
  }
}

/** What each format is for, and the rule to add around it. `egress` is the gateway's outbound addresses. */
export function formatGuide(egress: string[]) {
  const from = egress.length ? egress.join(', ') : 'the gateway’s outbound addresses';
  return [
    { id: 'domains' as const, label: 'Domain list', products: 'Palo Alto Networks External Dynamic List (Domain List), FortiGate external threat feed (Domain Name), Check Point, most firewalls',
      rule: `Add the URL as a domain list, refreshed hourly. Block it in a rule for all sources, and put a rule above it allowing ${from} to reach it.` },
    { id: 'zscaler' as const, label: 'Zscaler', products: 'Zscaler Internet Access custom URL category',
      rule: `Create the category from this file (or with the ZIA API, PUT /urlCategories/{id}), then a URL filtering rule that blocks it for every location except the one for ${from}.` },
    { id: 'netskope' as const, label: 'Netskope', products: 'Netskope URL list',
      rule: `Load it as a URL list (API: PUT /api/v2/policy/urllist/{id}), use it in a Real-time Protection policy set to Block, with an exception for ${from}.` },
    { id: 'rpz' as const, label: 'DNS RPZ', products: 'BIND, Infoblox, PowerDNS and other resolvers with response policy zones',
      rule: `Load it as a response policy zone transferred or fetched hourly. Exempt the gateway (${from}) with a client-IP policy, or have it use another resolver.` },
    { id: 'hosts' as const, label: 'Hosts file', products: 'Single machines and labs',
      rule: 'Only exact names; subdomains aren’t blocked. Use for testing, not as the lock.' },
  ];
}
