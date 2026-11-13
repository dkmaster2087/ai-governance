/**
 * The AI services Probaline recognizes. One list for the collector (reports), the gateway (Shadow AI page and
 * the browser extension's settings) and the AI-domain feed. No dependencies, so the standalone collector carries it
 * and works offline. Change CATALOG_VERSION whenever the built-in list changes; installs also apply newer signed
 * catalogs Probaline publishes (setCatalog), so new services reach them without a new version.
 *
 * `businessTerms`: whether the vendor offers business terms that keep customer data out of model training
 * ('offered'), or we have no record of such terms ('unknown'). It describes the vendor, not whether this
 * customer has signed them.
 */

export type Category =
  | 'chat' // a chat app people use in a browser
  | 'model_api' // a model API that apps call
  | 'coding' // a coding assistant
  | 'cloud_ai' // a cloud provider's own AI service
  | 'work_app'; // AI inside a work app the company may already pay for

export interface AiService {
  id: string;
  name: string;
  vendor: string;
  category: Category;
  businessTerms: 'offered' | 'unknown';
  /** Matched exactly or as a parent domain (`openai.com` matches `api.openai.com`). */
  domains: string[];
  /** For endpoints with a region or resource name in them. */
  patterns?: RegExp[];
  /**
   * Parent domains whose every subdomain belongs to the service (`*.openai.azure.com`), for block lists that take
   * wildcards. Only where `patterns` can be written that way; Bedrock and SageMaker can't, and are locked in AWS.
   */
  subdomainsOf?: string[];
  /**
   * Names identity providers and admin consoles use for the app (Okta, Entra, Google Workspace, …), lower case.
   * A sign-in to "ChatGPT Enterprise (Prod)" matches `chatgpt`; longer names are tried first.
   */
  appNames?: string[];
  /** Where people open it, for links on the extension's block page. Chat apps only. */
  url?: string;
  /** Earlier ids, so decisions saved under them still apply. */
  aliases?: string[];
}

export const CATALOG_VERSION = '2026-11-07';

/** The built-in list: what an install uses until it has verified a newer published catalog. */
const BUILT_IN: AiService[] = [
  // Chat apps
  { id: 'chatgpt', name: 'ChatGPT', vendor: 'OpenAI', category: 'chat', businessTerms: 'offered', domains: ['chatgpt.com', 'chat.openai.com'], appNames: ['chatgpt', 'chatgpt enterprise', 'chatgpt team', 'chatgpt edu', 'openai chatgpt'], url: 'https://chatgpt.com' },
  { id: 'claude', name: 'Claude', vendor: 'Anthropic', category: 'chat', businessTerms: 'offered', domains: ['claude.ai'], appNames: ['claude', 'claude for work', 'claude enterprise', 'claude team', 'anthropic claude'], url: 'https://claude.ai' },
  { id: 'gemini', name: 'Gemini', vendor: 'Google', category: 'chat', businessTerms: 'offered', domains: ['gemini.google.com', 'bard.google.com', 'aistudio.google.com'], appNames: ['gemini', 'google gemini'], url: 'https://gemini.google.com' },
  { id: 'copilot', name: 'Microsoft Copilot', vendor: 'Microsoft', category: 'chat', businessTerms: 'offered', domains: ['copilot.microsoft.com'], appNames: ['microsoft copilot'], url: 'https://copilot.microsoft.com' },
  { id: 'perplexity', name: 'Perplexity', vendor: 'Perplexity', category: 'chat', businessTerms: 'offered', domains: ['perplexity.ai'], appNames: ['perplexity', 'perplexity enterprise', 'perplexity enterprise pro'], url: 'https://www.perplexity.ai' },
  { id: 'meta-ai', name: 'Meta AI', vendor: 'Meta', category: 'chat', businessTerms: 'unknown', domains: ['meta.ai'], url: 'https://www.meta.ai' },
  { id: 'grok', name: 'Grok', vendor: 'xAI', category: 'chat', businessTerms: 'unknown', domains: ['grok.com'], appNames: ['grok'], url: 'https://grok.com' },
  { id: 'deepseek', name: 'DeepSeek', vendor: 'DeepSeek', category: 'chat', businessTerms: 'unknown', domains: ['chat.deepseek.com', 'deepseek.com'], appNames: ['deepseek'], url: 'https://chat.deepseek.com' },
  { id: 'mistral-chat', name: 'Le Chat', vendor: 'Mistral AI', category: 'chat', businessTerms: 'offered', domains: ['chat.mistral.ai'], appNames: ['le chat', 'mistral le chat'], aliases: ['mistral'], url: 'https://chat.mistral.ai' },
  { id: 'poe', name: 'Poe', vendor: 'Quora', category: 'chat', businessTerms: 'unknown', domains: ['poe.com'], appNames: ['poe'], url: 'https://poe.com' },
  { id: 'character-ai', name: 'Character.AI', vendor: 'Character.AI', category: 'chat', businessTerms: 'unknown', domains: ['character.ai'], appNames: ['character ai'], url: 'https://character.ai' },
  { id: 'huggingchat', name: 'Hugging Face', vendor: 'Hugging Face', category: 'chat', businessTerms: 'unknown', domains: ['huggingface.co'], appNames: ['hugging face', 'huggingface'], aliases: ['huggingface'], url: 'https://huggingface.co' },
  { id: 'you', name: 'You.com', vendor: 'You.com', category: 'chat', businessTerms: 'unknown', domains: ['you.com'], url: 'https://you.com' },
  { id: 'kimi', name: 'Kimi', vendor: 'Moonshot AI', category: 'chat', businessTerms: 'unknown', domains: ['kimi.com', 'kimi.moonshot.cn'], url: 'https://www.kimi.com' },
  { id: 'qwen-chat', name: 'Qwen Chat', vendor: 'Alibaba', category: 'chat', businessTerms: 'unknown', domains: ['chat.qwen.ai'], url: 'https://chat.qwen.ai' },
  { id: 'notebooklm', name: 'NotebookLM', vendor: 'Google', category: 'chat', businessTerms: 'offered', domains: ['notebooklm.google.com'], appNames: ['notebooklm'], url: 'https://notebooklm.google.com' },

  // Model APIs
  { id: 'openai-api', name: 'OpenAI API', vendor: 'OpenAI', category: 'model_api', businessTerms: 'offered', domains: ['api.openai.com'], appNames: ['openai platform', 'openai api'] },
  { id: 'anthropic-api', name: 'Anthropic API', vendor: 'Anthropic', category: 'model_api', businessTerms: 'offered', domains: ['api.anthropic.com'], appNames: ['anthropic console', 'anthropic api'] },
  { id: 'gemini-api', name: 'Gemini API', vendor: 'Google', category: 'model_api', businessTerms: 'offered', domains: ['generativelanguage.googleapis.com'] },
  { id: 'mistral-api', name: 'Mistral API', vendor: 'Mistral AI', category: 'model_api', businessTerms: 'offered', domains: ['api.mistral.ai'] },
  { id: 'cohere-api', name: 'Cohere API', vendor: 'Cohere', category: 'model_api', businessTerms: 'offered', domains: ['api.cohere.ai', 'api.cohere.com'] },
  { id: 'deepseek-api', name: 'DeepSeek API', vendor: 'DeepSeek', category: 'model_api', businessTerms: 'unknown', domains: ['api.deepseek.com'] },
  { id: 'xai-api', name: 'xAI API', vendor: 'xAI', category: 'model_api', businessTerms: 'unknown', domains: ['api.x.ai'] },
  { id: 'groq-api', name: 'Groq API', vendor: 'Groq', category: 'model_api', businessTerms: 'unknown', domains: ['api.groq.com'] },
  { id: 'together-api', name: 'Together AI', vendor: 'Together AI', category: 'model_api', businessTerms: 'unknown', domains: ['api.together.xyz', 'api.together.ai'] },
  { id: 'fireworks-api', name: 'Fireworks AI', vendor: 'Fireworks AI', category: 'model_api', businessTerms: 'unknown', domains: ['api.fireworks.ai'] },
  { id: 'openrouter', name: 'OpenRouter', vendor: 'OpenRouter', category: 'model_api', businessTerms: 'unknown', domains: ['openrouter.ai'] },
  { id: 'replicate', name: 'Replicate', vendor: 'Replicate', category: 'model_api', businessTerms: 'unknown', domains: ['api.replicate.com'] },
  { id: 'hf-inference', name: 'Hugging Face Inference', vendor: 'Hugging Face', category: 'model_api', businessTerms: 'unknown', domains: ['api-inference.huggingface.co', 'router.huggingface.co'] },
  { id: 'perplexity-api', name: 'Perplexity API', vendor: 'Perplexity', category: 'model_api', businessTerms: 'offered', domains: ['api.perplexity.ai'] },

  // Coding assistants
  { id: 'github-copilot', name: 'GitHub Copilot', vendor: 'GitHub', category: 'coding', businessTerms: 'offered', domains: ['githubcopilot.com', 'copilot-proxy.githubusercontent.com'], appNames: ['github copilot'] },
  { id: 'cursor', name: 'Cursor', vendor: 'Anysphere', category: 'coding', businessTerms: 'offered', domains: ['cursor.sh', 'cursor.com'], appNames: ['cursor'] },
  { id: 'codeium', name: 'Windsurf (Codeium)', vendor: 'Windsurf', category: 'coding', businessTerms: 'unknown', domains: ['codeium.com', 'windsurf.com'], appNames: ['windsurf', 'codeium'] },
  { id: 'tabnine', name: 'Tabnine', vendor: 'Tabnine', category: 'coding', businessTerms: 'offered', domains: ['tabnine.com'], appNames: ['tabnine'] },
  { id: 'replit', name: 'Replit', vendor: 'Replit', category: 'coding', businessTerms: 'unknown', domains: ['replit.com'], appNames: ['replit'] },

  // Cloud providers' own AI services
  {
    id: 'aws-bedrock', name: 'Amazon Bedrock', vendor: 'AWS', category: 'cloud_ai', businessTerms: 'offered', domains: [],
    patterns: [/^bedrock-runtime(-fips)?\.[a-z0-9-]+\.amazonaws\.com$/, /^bedrock-agent-runtime\.[a-z0-9-]+\.amazonaws\.com$/],
  },
  {
    id: 'aws-sagemaker', name: 'Amazon SageMaker endpoints', vendor: 'AWS', category: 'cloud_ai', businessTerms: 'offered', domains: [],
    patterns: [/^runtime\.sagemaker\.[a-z0-9-]+\.amazonaws\.com$/],
  },
  {
    id: 'azure-openai', name: 'Azure OpenAI / AI Foundry', vendor: 'Microsoft', category: 'cloud_ai', businessTerms: 'offered', domains: [],
    patterns: [/^[a-z0-9-]+\.openai\.azure\.com$/, /^[a-z0-9-]+\.services\.ai\.azure\.com$/, /^[a-z0-9-]+\.cognitiveservices\.azure\.com$/],
    subdomainsOf: ['openai.azure.com', 'services.ai.azure.com', 'cognitiveservices.azure.com'],
  },
  {
    id: 'vertex-ai', name: 'Vertex AI', vendor: 'Google Cloud', category: 'cloud_ai', businessTerms: 'offered', domains: ['aiplatform.googleapis.com'],
    patterns: [/^[a-z0-9-]+-aiplatform\.googleapis\.com$/],
  },

  // AI inside work apps
  { id: 'm365-copilot', name: 'Microsoft 365 Copilot', vendor: 'Microsoft', category: 'work_app', businessTerms: 'offered', domains: ['m365copilot.com', 'copilot.cloud.microsoft'], appNames: ['microsoft 365 copilot', 'm365 copilot', 'copilot for microsoft 365', 'microsoft copilot for microsoft 365'] },
  { id: 'gemini-workspace', name: 'Gemini in Google Workspace', vendor: 'Google', category: 'work_app', businessTerms: 'offered', domains: [], appNames: ['gemini for google workspace', 'gemini in google workspace'] },
  { id: 'otter', name: 'Otter.ai', vendor: 'Otter.ai', category: 'work_app', businessTerms: 'unknown', domains: ['otter.ai'], appNames: ['otter', 'otter ai'] },
  { id: 'fireflies', name: 'Fireflies.ai', vendor: 'Fireflies.ai', category: 'work_app', businessTerms: 'unknown', domains: ['fireflies.ai'], appNames: ['fireflies', 'fireflies ai'] },
  { id: 'grammarly', name: 'Grammarly', vendor: 'Grammarly', category: 'work_app', businessTerms: 'offered', domains: ['grammarly.com', 'grammarly.io'], appNames: ['grammarly'] },
];

// ── The catalog in use ──────────────────────────────────────────────────────────────────────────────────────────
//
// The list above is built in, so an install works offline and from its first start. Probaline publishes newer
// catalogs as signed data (docs/ASSESSMENT.md, "The AI service catalog"); an install that verifies one calls
// setCatalog, and every lookup below, and every list built from the catalog (onCatalogChange), uses it at once.

/** Where the catalog in use came from. */
export type CatalogSource = 'built-in' | 'feed' | 'upload';

/** A service as it travels in a published catalog: patterns are regular-expression source text. */
export type AiServiceData = Omit<AiService, 'patterns'> & { patterns?: string[] };

/** News about a service in the catalog (a change in its data terms, a breach); shown only where it's in use. */
export interface CatalogAdvisory {
  id: string;
  serviceId: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  publishedAt: string;
  url?: string;
}

/** A published catalog: what a signed catalog document carries. */
export interface CatalogData {
  /** Increases with every publication (seconds since 1970 at publication); an older one is never applied. */
  sequence: number;
  /** For people: the date or name of this edition. */
  version: string;
  publishedAt: string;
  services: AiServiceData[];
  advisories?: CatalogAdvisory[];
}

export interface CatalogInfo {
  sequence: number;
  version: string;
  publishedAt: string;
  source: CatalogSource;
  services: number;
  advisories: CatalogAdvisory[];
}

const BUILT_IN_PUBLISHED = `${CATALOG_VERSION}T00:00:00.000Z`;
/** The built-in list's place in the order of publications, so a feed older than the image isn't applied over it. */
export const BUILT_IN_SEQUENCE = Math.floor(Date.parse(BUILT_IN_PUBLISHED) / 1000);

/**
 * The services in use. The same array object for the life of the process (its contents are replaced when a newer
 * catalog is applied), so code that kept a reference still sees the current list.
 */
export const CATALOG: AiService[] = [...BUILT_IN];
let info: CatalogInfo = { sequence: BUILT_IN_SEQUENCE, version: CATALOG_VERSION, publishedAt: BUILT_IN_PUBLISHED, source: 'built-in', services: BUILT_IN.length, advisories: [] };

const byId = new Map<string, AiService>();
let appNames: Array<{ name: string; service: AiService }> = [];
const appKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clean = (domain: string) => domain.trim().toLowerCase().replace(/\.$/, '');

function index() {
  byId.clear();
  for (const s of CATALOG) for (const id of [s.id, ...(s.aliases ?? [])]) byId.set(id, s);
  appNames = CATALOG.flatMap((s) => (s.appNames ?? []).map((n) => ({ name: appKey(n), service: s })))
    .sort((a, b) => b.name.length - a.name.length);
}
index();

const listeners = new Set<() => void>();
/** Run `fn` whenever a different catalog is applied (to rebuild lists made from it). Returns a function that stops it. */
export function onCatalogChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The services in use. */
export const catalog = (): readonly AiService[] => CATALOG;
/** The edition in use, as people see it (a date for the built-in list). */
export const catalogVersion = (): string => info.version;
/** Which catalog is in use, where it came from, and its advisories. */
export const catalogInfo = (): CatalogInfo => ({ ...info, advisories: [...info.advisories] });

const CATEGORIES: readonly Category[] = ['chat', 'model_api', 'coding', 'cloud_ai', 'work_app'];
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class CatalogDataError extends Error {}

/** A pattern from a published catalog: anchored at both ends and short, so it can't match unrelated names or run long. */
function compilePattern(src: string, serviceId: string): RegExp {
  if (typeof src !== 'string' || src.length > 200 || !src.startsWith('^') || !src.endsWith('$')) {
    throw new CatalogDataError(`Service ${serviceId}: a pattern must be anchored (^…$) and at most 200 characters`);
  }
  try {
    return new RegExp(src);
  } catch {
    throw new CatalogDataError(`Service ${serviceId}: a pattern isn't a valid regular expression`);
  }
}

/** Services from published data, checked field by field; throws CatalogDataError on anything malformed. */
export function servicesFromData(data: CatalogData): AiService[] {
  if (!data || typeof data !== 'object' || !Array.isArray(data.services)) throw new CatalogDataError('A catalog needs a list of services');
  if (!Number.isInteger(data.sequence) || data.sequence <= 0) throw new CatalogDataError('A catalog needs a positive whole-number sequence');
  if (typeof data.version !== 'string' || !data.version || data.version.length > 20 || Number.isNaN(Date.parse(data.publishedAt))) {
    throw new CatalogDataError('A catalog needs a version (at most 20 characters) and a publication time');
  }
  if (data.services.length === 0 || data.services.length > 20_000) throw new CatalogDataError('A catalog needs between 1 and 20,000 services');
  const seen = new Set<string>();
  return data.services.map((s): AiService => {
    if (!s || typeof s.id !== 'string' || !ID.test(s.id)) throw new CatalogDataError(`A service has a missing or malformed id: ${String(s?.id).slice(0, 80)}`);
    if (seen.has(s.id)) throw new CatalogDataError(`Service ${s.id} appears twice`);
    seen.add(s.id);
    if (typeof s.name !== 'string' || !s.name || typeof s.vendor !== 'string') throw new CatalogDataError(`Service ${s.id} needs a name and a vendor`);
    if (!CATEGORIES.includes(s.category)) throw new CatalogDataError(`Service ${s.id} has an unknown category`);
    if (s.businessTerms !== 'offered' && s.businessTerms !== 'unknown') throw new CatalogDataError(`Service ${s.id} has unknown business terms`);
    if (!Array.isArray(s.domains) || s.domains.some((d) => typeof d !== 'string' || !DOMAIN.test(d))) throw new CatalogDataError(`Service ${s.id} has a malformed domain`);
    const strings = (v: unknown, what: string) => {
      if (v === undefined) return undefined;
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x || x.length > 200)) throw new CatalogDataError(`Service ${s.id} has malformed ${what}`);
      return v as string[];
    };
    const subdomainsOf = strings(s.subdomainsOf, 'parent domains');
    if (subdomainsOf?.some((d) => !DOMAIN.test(d))) throw new CatalogDataError(`Service ${s.id} has a malformed parent domain`);
    if (s.url !== undefined && (typeof s.url !== 'string' || !/^https:\/\//.test(s.url))) throw new CatalogDataError(`Service ${s.id} has a link that isn't https`);
    return {
      id: s.id, name: s.name, vendor: s.vendor, category: s.category, businessTerms: s.businessTerms,
      domains: s.domains.map(clean),
      ...(s.patterns ? { patterns: strings(s.patterns, 'patterns')!.map((p) => compilePattern(p, s.id)) } : {}),
      ...(subdomainsOf ? { subdomainsOf } : {}),
      ...(s.appNames ? { appNames: strings(s.appNames, 'app names')!.map((n) => n.toLowerCase()) } : {}),
      ...(s.url ? { url: s.url } : {}),
      ...(s.aliases ? { aliases: strings(s.aliases, 'earlier ids') } : {}),
    };
  });
}

/** Advisories from published data, keeping only well-formed ones about services in the catalog. */
function advisoriesFromData(data: CatalogData, services: AiService[]): CatalogAdvisory[] {
  const ids = new Set(services.map((s) => s.id));
  const severities = ['info', 'warning', 'critical'];
  return (Array.isArray(data.advisories) ? data.advisories : []).filter((a) =>
    a && typeof a.id === 'string' && ids.has(a.serviceId) && severities.includes(a.severity) &&
    typeof a.title === 'string' && typeof a.detail === 'string' && !Number.isNaN(Date.parse(a.publishedAt)) &&
    (a.url === undefined || /^https:\/\//.test(a.url)),
  ).slice(0, 1000);
}

/**
 * Use a published catalog (already verified by the caller). Returns false, changing nothing, when it is not newer
 * than the one in use: an older catalog is never applied, so a replayed old file can't remove services.
 * Throws CatalogDataError when it is malformed.
 */
export function setCatalog(data: CatalogData, source: Exclude<CatalogSource, 'built-in'>): boolean {
  const services = servicesFromData(data);
  if (data.sequence <= info.sequence) return false;
  CATALOG.splice(0, CATALOG.length, ...services);
  info = { sequence: data.sequence, version: data.version, publishedAt: data.publishedAt, source, services: services.length, advisories: advisoriesFromData(data, services) };
  index();
  for (const fn of listeners) fn();
  return true;
}

/** Go back to the built-in list (tests, and an admin who wants to stop using updates). */
export function resetCatalog(): void {
  CATALOG.splice(0, CATALOG.length, ...BUILT_IN);
  info = { sequence: BUILT_IN_SEQUENCE, version: CATALOG_VERSION, publishedAt: BUILT_IN_PUBLISHED, source: 'built-in', services: BUILT_IN.length, advisories: [] };
  index();
  for (const fn of listeners) fn();
}

/** The built-in list as publishable data (the starting point of the published catalog). */
export function builtInCatalogData(sequence: number, version: string, publishedAt = new Date(sequence * 1000).toISOString()): CatalogData {
  return {
    sequence, version, publishedAt,
    services: BUILT_IN.map(({ patterns, ...s }) => ({ ...s, ...(patterns ? { patterns: patterns.map((p) => p.source) } : {}) })),
    advisories: [],
  };
}

// ── Lookups ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A service by id, or by an earlier id it was known by. */
export const serviceById = (id: string): AiService | undefined => byId.get(id);

/**
 * The AI service a domain belongs to, or undefined if it isn't one we know. The longest listed domain wins, so
 * `api.deepseek.com` is the DeepSeek API even though `deepseek.com` is DeepSeek's chat app.
 */
export function serviceForDomain(domain: string): AiService | undefined {
  const d = clean(domain);
  if (!d) return undefined;
  let best: { service: AiService; length: number } | undefined;
  for (const s of CATALOG) {
    for (const x of s.domains) {
      if ((d === x || d.endsWith(`.${x}`)) && (!best || x.length > best.length)) best = { service: s, length: x.length };
    }
  }
  if (best) return best.service;
  return CATALOG.find((s) => s.patterns?.some((p) => p.test(d)));
}

/** Every listed domain of the services in these categories (all categories when none are given). */
export function catalogDomains(categories?: Category[]): string[] {
  const wanted = categories ? new Set(categories) : null;
  return [...new Set(CATALOG.filter((s) => !wanted || wanted.has(s.category)).flatMap((s) => s.domains))];
}

/**
 * The AI service an app name belongs to, as an identity provider or admin console shows it ("ChatGPT
 * Enterprise", "Claude for Work (prod)"). The name must start with a known app name, word for word, so
 * "Cursor Analytics Dashboard" is a match for Cursor but "Precursor" is not.
 */
export function serviceForAppName(appName: string): AiService | undefined {
  const k = appKey(appName);
  if (!k) return undefined;
  return appNames.find((a) => k === a.name || k.startsWith(`${a.name} `))?.service;
}

export { clean as normalizeDomain };
