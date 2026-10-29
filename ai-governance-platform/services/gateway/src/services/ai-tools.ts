/** Known consumer AI tools, so raw domains from the browser extension group into named tools. */
export interface AiTool {
  id: string;
  name: string;
  domains: string[];
}

export const AI_TOOLS: AiTool[] = [
  { id: 'chatgpt', name: 'ChatGPT', domains: ['chatgpt.com', 'chat.openai.com'] },
  { id: 'claude', name: 'Claude', domains: ['claude.ai'] },
  { id: 'gemini', name: 'Gemini', domains: ['gemini.google.com', 'bard.google.com', 'aistudio.google.com'] },
  { id: 'copilot', name: 'Microsoft Copilot', domains: ['copilot.microsoft.com'] },
  { id: 'perplexity', name: 'Perplexity', domains: ['perplexity.ai'] },
  { id: 'deepseek', name: 'DeepSeek', domains: ['chat.deepseek.com', 'deepseek.com'] },
  { id: 'mistral', name: 'Le Chat (Mistral)', domains: ['chat.mistral.ai'] },
  { id: 'huggingface', name: 'Hugging Face', domains: ['huggingface.co'] },
  { id: 'openai-api', name: 'OpenAI API, called directly', domains: ['api.openai.com'] },
  { id: 'anthropic-api', name: 'Anthropic API, called directly', domains: ['api.anthropic.com'] },
];

const UNKNOWN_PREFIX = 'domain:';

function matches(domain: string, d: string): boolean {
  return domain === d || domain.endsWith('.' + d);
}

/** The tool a visited domain belongs to; unknown domains become a tool of their own. */
export function toolForDomain(domain: string): AiTool {
  const d = domain.toLowerCase();
  return AI_TOOLS.find((t) => t.domains.some((x) => matches(d, x))) ?? { id: UNKNOWN_PREFIX + d, name: d, domains: [d] };
}

export function toolById(id: string): AiTool | null {
  if (id.startsWith(UNKNOWN_PREFIX)) {
    const domain = id.slice(UNKNOWN_PREFIX.length);
    return /^[a-z0-9.-]{1,253}$/.test(domain) ? { id, name: domain, domains: [domain] } : null;
  }
  return AI_TOOLS.find((t) => t.id === id) ?? null;
}
