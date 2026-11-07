/**
 * The AI services Probaline recognizes. One list for the collector (reports), the gateway (Shadow AI page and
 * the browser extension's settings) and, later, the domain feed. No dependencies, so the standalone collector
 * carries it and works offline. Change CATALOG_VERSION whenever the list changes.
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

export const CATALOG: AiService[] = [
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

const byId = new Map<string, AiService>();
for (const s of CATALOG) for (const id of [s.id, ...(s.aliases ?? [])]) byId.set(id, s);
/** A service by id, or by an earlier id it was known by. */
export const serviceById = (id: string): AiService | undefined => byId.get(id);

const clean = (domain: string) => domain.trim().toLowerCase().replace(/\.$/, '');

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

const appKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const APP_NAMES = CATALOG.flatMap((s) => (s.appNames ?? []).map((n) => ({ name: appKey(n), service: s })))
  .sort((a, b) => b.name.length - a.name.length);

/**
 * The AI service an app name belongs to, as an identity provider or admin console shows it ("ChatGPT
 * Enterprise", "Claude for Work (prod)"). The name must start with a known app name, word for word, so
 * "Cursor Analytics Dashboard" is a match for Cursor but "Precursor" is not.
 */
export function serviceForAppName(appName: string): AiService | undefined {
  const k = appKey(appName);
  if (!k) return undefined;
  return APP_NAMES.find((a) => k === a.name || k.startsWith(`${a.name} `))?.service;
}

export { clean as normalizeDomain };
