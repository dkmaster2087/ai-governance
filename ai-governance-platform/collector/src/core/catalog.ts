/**
 * The AI services the collector recognizes. Shipped with the collector so it works offline.
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
}

export const CATALOG_VERSION = '2026-10-31';

export const CATALOG: AiService[] = [
  // Chat apps
  { id: 'chatgpt', name: 'ChatGPT', vendor: 'OpenAI', category: 'chat', businessTerms: 'offered', domains: ['chatgpt.com', 'chat.openai.com'] },
  { id: 'claude', name: 'Claude', vendor: 'Anthropic', category: 'chat', businessTerms: 'offered', domains: ['claude.ai'] },
  { id: 'gemini', name: 'Gemini', vendor: 'Google', category: 'chat', businessTerms: 'offered', domains: ['gemini.google.com', 'bard.google.com', 'aistudio.google.com'] },
  { id: 'copilot', name: 'Microsoft Copilot', vendor: 'Microsoft', category: 'chat', businessTerms: 'offered', domains: ['copilot.microsoft.com'] },
  { id: 'perplexity', name: 'Perplexity', vendor: 'Perplexity', category: 'chat', businessTerms: 'offered', domains: ['perplexity.ai'] },
  { id: 'meta-ai', name: 'Meta AI', vendor: 'Meta', category: 'chat', businessTerms: 'unknown', domains: ['meta.ai'] },
  { id: 'grok', name: 'Grok', vendor: 'xAI', category: 'chat', businessTerms: 'unknown', domains: ['grok.com'] },
  { id: 'deepseek', name: 'DeepSeek', vendor: 'DeepSeek', category: 'chat', businessTerms: 'unknown', domains: ['chat.deepseek.com'] },
  { id: 'mistral-chat', name: 'Le Chat', vendor: 'Mistral AI', category: 'chat', businessTerms: 'offered', domains: ['chat.mistral.ai'] },
  { id: 'poe', name: 'Poe', vendor: 'Quora', category: 'chat', businessTerms: 'unknown', domains: ['poe.com'] },
  { id: 'character-ai', name: 'Character.AI', vendor: 'Character.AI', category: 'chat', businessTerms: 'unknown', domains: ['character.ai'] },
  { id: 'huggingchat', name: 'Hugging Face', vendor: 'Hugging Face', category: 'chat', businessTerms: 'unknown', domains: ['huggingface.co'] },
  { id: 'you', name: 'You.com', vendor: 'You.com', category: 'chat', businessTerms: 'unknown', domains: ['you.com'] },
  { id: 'kimi', name: 'Kimi', vendor: 'Moonshot AI', category: 'chat', businessTerms: 'unknown', domains: ['kimi.com', 'kimi.moonshot.cn'] },
  { id: 'qwen-chat', name: 'Qwen Chat', vendor: 'Alibaba', category: 'chat', businessTerms: 'unknown', domains: ['chat.qwen.ai'] },
  { id: 'notebooklm', name: 'NotebookLM', vendor: 'Google', category: 'chat', businessTerms: 'offered', domains: ['notebooklm.google.com'] },

  // Model APIs
  { id: 'openai-api', name: 'OpenAI API', vendor: 'OpenAI', category: 'model_api', businessTerms: 'offered', domains: ['api.openai.com'] },
  { id: 'anthropic-api', name: 'Anthropic API', vendor: 'Anthropic', category: 'model_api', businessTerms: 'offered', domains: ['api.anthropic.com'] },
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
  { id: 'github-copilot', name: 'GitHub Copilot', vendor: 'GitHub', category: 'coding', businessTerms: 'offered', domains: ['githubcopilot.com', 'copilot-proxy.githubusercontent.com'] },
  { id: 'cursor', name: 'Cursor', vendor: 'Anysphere', category: 'coding', businessTerms: 'offered', domains: ['cursor.sh', 'cursor.com'] },
  { id: 'codeium', name: 'Windsurf (Codeium)', vendor: 'Windsurf', category: 'coding', businessTerms: 'unknown', domains: ['codeium.com', 'windsurf.com'] },
  { id: 'tabnine', name: 'Tabnine', vendor: 'Tabnine', category: 'coding', businessTerms: 'offered', domains: ['tabnine.com'] },
  { id: 'replit', name: 'Replit', vendor: 'Replit', category: 'coding', businessTerms: 'unknown', domains: ['replit.com'] },

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
  { id: 'm365-copilot', name: 'Microsoft 365 Copilot', vendor: 'Microsoft', category: 'work_app', businessTerms: 'offered', domains: ['m365copilot.com', 'copilot.cloud.microsoft'] },
  { id: 'otter', name: 'Otter.ai', vendor: 'Otter.ai', category: 'work_app', businessTerms: 'unknown', domains: ['otter.ai'] },
  { id: 'fireflies', name: 'Fireflies.ai', vendor: 'Fireflies.ai', category: 'work_app', businessTerms: 'unknown', domains: ['fireflies.ai'] },
  { id: 'grammarly', name: 'Grammarly', vendor: 'Grammarly', category: 'work_app', businessTerms: 'offered', domains: ['grammarly.com', 'grammarly.io'] },
];

const byId = new Map(CATALOG.map((s) => [s.id, s]));
export const serviceById = (id: string): AiService | undefined => byId.get(id);

const clean = (domain: string) => domain.trim().toLowerCase().replace(/\.$/, '');

/** The AI service a domain belongs to, or undefined if it isn't one we know. */
export function serviceForDomain(domain: string): AiService | undefined {
  const d = clean(domain);
  if (!d) return undefined;
  for (const s of CATALOG) {
    if (s.domains.some((x) => d === x || d.endsWith(`.${x}`))) return s;
    if (s.patterns?.some((p) => p.test(d))) return s;
  }
  return undefined;
}

export { clean as normalizeDomain };
