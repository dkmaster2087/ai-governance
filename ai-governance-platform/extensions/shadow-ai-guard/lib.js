/**
 * Probaline Shadow AI Guard: the decisions, kept free of Chrome APIs so they can be tested in Node.
 * Used by background.js (the service worker) and by the tests in tests/.
 */

/** Tools watched before the first sync with the gateway. The gateway's list replaces this one. */
export const DEFAULT_WATCHED = [
  'chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com', 'bard.google.com', 'aistudio.google.com',
  'copilot.microsoft.com', 'perplexity.ai', 'chat.deepseek.com', 'deepseek.com', 'chat.mistral.ai',
  'huggingface.co', 'api.openai.com', 'api.anthropic.com',
];

export const DEFAULTS = {
  gatewayUrl: '',
  apiKey: '',
  // Report the work email the Chrome profile is signed in with. Off unless IT turns it on.
  identifyUsers: false,
  // From the gateway (the company's decisions on the Shadow AI page).
  mode: 'monitor',
  blockedDomains: DEFAULT_WATCHED, // every watched tool (name kept from older versions)
  enforcedDomains: [], // blocked by decision, whatever the mode
  allowedDomains: [], // approved: never blocked or recorded
  blockPage: {
    message: 'Your company hasn’t approved this AI tool. Use one of the approved tools instead.',
    links: [],
  },
};

/** Settings IT may push through Chrome policy (see schema.json). */
export const MANAGED_KEYS = ['gatewayUrl', 'apiKey', 'identifyUsers'];
/** Settings the gateway may send. It can't change where the extension reports or with which key. */
const REMOTE_KEYS = ['mode', 'blockedDomains', 'enforcedDomains', 'allowedDomains', 'blockPage'];

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined).map((k) => [k, obj[k]]));

/**
 * The settings in force. Highest wins: IT policy, then the gateway's decisions, then what was typed in the
 * popup (only possible when IT hasn't set it), then defaults.
 */
export function effectiveConfig({ local = {}, remote = {}, managed = {} } = {}) {
  const managedSet = pick(managed, MANAGED_KEYS);
  const typed = Object.keys(managedSet).length > 0 ? {} : pick(local, MANAGED_KEYS);
  return { ...DEFAULTS, ...typed, ...pick(remote, REMOTE_KEYS), ...managedSet };
}

/** Whether IT manages this install (then the popup is read-only). */
export const isManaged = (managed) => Object.keys(pick(managed, MANAGED_KEYS)).length > 0;

export const matchesAny = (domain, list) => (list || []).some((d) => domain === d || domain.endsWith(`.${d}`));

export const isWatched = (domain, c) => matchesAny(domain, c.blockedDomains) || matchesAny(domain, c.enforcedDomains);

/** Blocked if the company blocked this tool, or blocks every undecided tool and this one isn't approved. */
export function isBlocked(domain, c) {
  if (matchesAny(domain, c.allowedDomains)) return false;
  if (matchesAny(domain, c.enforcedDomains)) return true;
  return c.mode === 'block' && matchesAny(domain, c.blockedDomains);
}

/** Domains the extension blocks right now. */
export function blockedList(c) {
  const candidates = [...(c.enforcedDomains || []), ...(c.mode === 'block' ? c.blockedDomains || [] : [])];
  return [...new Set(candidates)].filter((d) => !matchesAny(d, c.allowedDomains));
}

/**
 * declarativeNetRequest rules: pages open the extension's block page; background calls from other pages
 * (scripts calling an AI API) are simply refused.
 */
export function blockingRules(c) {
  return blockedList(c).flatMap((domain, i) => [
    {
      id: i * 2 + 1,
      priority: 2,
      action: { type: 'redirect', redirect: { extensionPath: `/blocked.html?domain=${encodeURIComponent(domain)}` } },
      condition: { urlFilter: `||${domain}`, resourceTypes: ['main_frame'] },
    },
    {
      id: i * 2 + 2,
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: `||${domain}`, resourceTypes: ['sub_frame', 'xmlhttprequest', 'websocket', 'other'] },
    },
  ]);
}

/** One sighting per tool, kind and window, so a busy ChatGPT tab is one visit, not hundreds of requests. */
export const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

/**
 * The event to record for a request, or null. Only the domain is kept: never the full address, which can
 * hold conversation IDs or search text.
 */
export function sighting(details, c, { now = Date.now(), lastSeen = {}, user = 'unknown' } = {}) {
  let domain;
  try {
    const url = new URL(details.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'wss:') return null;
    domain = url.hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!isWatched(domain, c) || matchesAny(domain, c.allowedDomains)) return null;

  const kind = details.type === 'main_frame' ? 'visit' : 'background';
  const key = `${domain}|${kind}`;
  if (lastSeen[key] && now - lastSeen[key] < DEDUPE_WINDOW_MS) return null;
  lastSeen[key] = now;

  return {
    id: `evt_${now}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date(now).toISOString(),
    domain,
    type: kind,
    blocked: isBlocked(domain, c),
    userId: user,
    source: 'browser_extension',
  };
}

/** Forget dedupe entries older than the window, so the stored map stays small. */
export function pruneSeen(lastSeen, now = Date.now()) {
  return Object.fromEntries(Object.entries(lastSeen).filter(([, t]) => now - t < DEDUPE_WINDOW_MS));
}

/** Links for the block page: https only, whatever the gateway sent. */
export function safeLinks(links) {
  return (links || []).filter((l) => {
    try { return new URL(l.url).protocol === 'https:' && typeof l.name === 'string' && l.name.trim(); } catch { return false; }
  }).slice(0, 10);
}

export const MAX_QUEUE = 1000;
export const BATCH = 500;
