/**
 * Where new AI services are found (docs/ASSESSMENT.md, "Finding new AI services"). Each source turns a public feed
 * into candidate domains; the discovery job skips the ones already in the catalog or already reviewed, and the
 * classifier and a person decide the rest. Only public endpoints are read, without credentials.
 */

export interface RawCandidate {
  /** Host name as found; normalized to the domain to review by `candidateDomain`. */
  host: string;
  /** What the source called it. */
  title?: string;
  /** Where it was found, for the reviewer. */
  url?: string;
  /** A category the source implies (a model provider is a model API). */
  hint?: 'model_api' | 'chat';
}

export interface DiscoverySource {
  name: string;
  label: string;
  /** How often to read it. */
  everyMinutes: number;
  run(get: (url: string) => Promise<unknown>, since: Date): Promise<RawCandidate[]>;
}

/** Hosting platforms where each customer gets a subdomain: the full host name is the service, not the platform. */
const SHARED_HOSTS = ['vercel.app', 'netlify.app', 'github.io', 'pages.dev', 'workers.dev', 'fly.dev', 'onrender.com', 'herokuapp.com',
  'streamlit.app', 'hf.space', 'replit.app', 'web.app', 'firebaseapp.com', 'azurewebsites.net', 'notion.site', 'framer.website', 'webflow.io'];
/** Two-label public suffixes common enough to matter (co.uk, com.au, …). */
const TWO_LABEL_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'co.jp', 'co.kr', 'com.br', 'com.cn', 'com.tw', 'com.sg', 'co.in', 'co.nz', 'co.za', 'com.mx', 'com.tr', 'co.il']);
/** Sites that host everything; a link to them names no AI service. */
const GENERIC = new Set(['github.com', 'gitlab.com', 'youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'medium.com', 'substack.com', 'arxiv.org',
  'google.com', 'apple.com', 'microsoft.com', 'amazon.com', 'linkedin.com', 'reddit.com', 'wikipedia.org', 'producthunt.com', 'news.ycombinator.com',
  'docs.google.com', 'drive.google.com', 'loom.com', 'discord.gg', 'discord.com', 't.me', 'npmjs.com', 'pypi.org', 'crates.io', 'colab.research.google.com']);

/**
 * The domain a person reviews for a host: its registrable domain (`app.newco.ai` → `newco.ai`), or the whole host
 * on a shared hosting platform (`newco.vercel.app`). Null for addresses, single labels and generic sites.
 */
export function candidateDomain(host: string): string | null {
  const h = host.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (!/^[a-z0-9.-]+$/.test(h) || !h.includes('.') || /^\d+(\.\d+){3}$/.test(h)) return null;
  const labels = h.split('.');
  if (labels.some((l) => !l || l.length > 63)) return null;
  for (const shared of SHARED_HOSTS) {
    if (h === shared) return null;
    if (h.endsWith(`.${shared}`)) return h.split('.').slice(-(shared.split('.').length + 1)).join('.');
  }
  const lastTwo = labels.slice(-2).join('.');
  const keep = TWO_LABEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  if (labels.length < keep) return null;
  const domain = labels.slice(-keep).join('.');
  if (GENERIC.has(domain) || GENERIC.has(h)) return null;
  return domain;
}

const hostOf = (url: unknown): string | null => {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname : null;
  } catch {
    return null;
  }
};

/** models.dev: an open database of AI model providers, each with its API base address. */
export const modelsDev: DiscoverySource = {
  name: 'models-dev',
  label: 'models.dev provider list',
  everyMinutes: 60,
  async run(get) {
    const data = await get('https://models.dev/api.json');
    if (!data || typeof data !== 'object') throw new Error('models.dev answered with something other than a provider list');
    const out: RawCandidate[] = [];
    for (const [id, p] of Object.entries(data as Record<string, Record<string, unknown>>)) {
      const host = hostOf(p?.api) ?? hostOf(p?.doc);
      if (host) out.push({ host, title: typeof p.name === 'string' ? p.name : id, url: typeof p.doc === 'string' ? p.doc : `https://models.dev/#${id}`, hint: 'model_api' });
    }
    return out;
  },
};

/** OpenRouter's provider list: model providers with their privacy-policy and terms addresses. */
export const openRouterProviders: DiscoverySource = {
  name: 'openrouter',
  label: 'OpenRouter providers',
  everyMinutes: 360,
  async run(get) {
    const data = (await get('https://openrouter.ai/api/v1/providers')) as { data?: Array<Record<string, unknown>> };
    if (!Array.isArray(data?.data)) throw new Error('OpenRouter answered with something other than a provider list');
    return data.data.flatMap((p) => {
      const host = hostOf(p.privacy_policy_url) ?? hostOf(p.terms_of_service_url) ?? hostOf(p.status_page_url);
      return host ? [{ host, title: typeof p.name === 'string' ? p.name : undefined, url: typeof p.privacy_policy_url === 'string' ? p.privacy_policy_url : undefined, hint: 'model_api' as const }] : [];
    });
  },
};

/** Hacker News "Show HN" launches mentioning AI, LLMs, agents or GPT since the last run. */
export const hackerNews: DiscoverySource = {
  name: 'hacker-news',
  label: 'Hacker News “Show HN” launches',
  everyMinutes: 60,
  async run(get, since) {
    const after = Math.floor(since.getTime() / 1000);
    const out: RawCandidate[] = [];
    for (const query of ['AI', 'LLM', 'agent', 'GPT', 'copilot']) {
      const data = (await get(`https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&query=${encodeURIComponent(query)}&numericFilters=created_at_i>${after}&hitsPerPage=100`)) as { hits?: Array<Record<string, unknown>> };
      for (const hit of data?.hits ?? []) {
        const host = hostOf(hit.url);
        if (host) out.push({ host, title: typeof hit.title === 'string' ? hit.title.replace(/^Show HN:\s*/i, '') : undefined, url: `https://news.ycombinator.com/item?id=${String(hit.objectID ?? '')}` });
      }
    }
    return out;
  },
};

export const SOURCES: DiscoverySource[] = [modelsDev, openRouterProviders, hackerNews];
