// Shared by the gateway and analytics. Built from the AI catalog (@ai-governance/catalog), the one list of AI
// services the collector, the gateway and the browser extension all use.
import { AiService, CATALOG, CATALOG_VERSION, Category, catalogVersion, onCatalogChange, serviceById, serviceForDomain } from '@ai-governance/catalog';

/** AI tools reached outside the gateway, so raw domains from the browser extension group into named tools. */
export interface AiTool {
  id: string;
  name: string;
  domains: string[];
  /** Where people open it, for links on the extension's block page. */
  url?: string;
}

export { CATALOG_VERSION, catalogVersion };

/**
 * The part of the shared catalog the extension watches: chat apps and model APIs, which people reach in a
 * browser. Coding assistants and work apps are left out, so block mode doesn't stop editors or licensed tools.
 */
const BROWSER_CATEGORIES: Category[] = ['chat', 'model_api'];

const toTool = (s: AiService): AiTool => ({ id: s.id, name: s.name, domains: s.domains, ...(s.url ? { url: s.url } : {}) });

/** The watched tools. The same array for the life of the process; rebuilt in place when a newer catalog is applied. */
export const AI_TOOLS: AiTool[] = [];
const watched = new Set<string>();
function build() {
  AI_TOOLS.splice(0, AI_TOOLS.length, ...CATALOG.filter((s) => BROWSER_CATEGORIES.includes(s.category) && s.domains.length > 0).map(toTool));
  watched.clear();
  for (const t of AI_TOOLS) watched.add(t.id);
}
build();
onCatalogChange(build);

const UNKNOWN_PREFIX = 'domain:';

/** The tool a visited domain belongs to; domains outside the watched list become a tool of their own. */
export function toolForDomain(domain: string): AiTool {
  const d = domain.toLowerCase();
  const service = serviceForDomain(d);
  if (service && watched.has(service.id)) return toTool(service);
  return { id: UNKNOWN_PREFIX + d, name: d, domains: [d] };
}

/** A tool by id; earlier ids (`mistral`, `huggingface`) still resolve, to the tool's current id. */
export function toolById(id: string): AiTool | null {
  if (id.startsWith(UNKNOWN_PREFIX)) {
    const domain = id.slice(UNKNOWN_PREFIX.length);
    return /^[a-z0-9.-]{1,253}$/.test(domain) ? { id, name: domain, domains: [domain] } : null;
  }
  const service = serviceById(id);
  return service && watched.has(service.id) ? toTool(service) : null;
}

/** The id decisions are saved under: the tool's current id, or the id as given for domains. */
export function canonicalToolId(id: string): string {
  return toolById(id)?.id ?? id;
}
