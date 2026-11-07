import { collection } from '@ai-governance/storage';
import { AI_TOOLS, canonicalToolId, toolById } from './ai-tools';

export type ToolDecision = 'blocked' | 'allowed';

export interface GuidanceLink { name: string; url: string }

/** What employees see when the extension blocks a tool. */
export interface BlockGuidance {
  message: string;
  /** Approved alternatives the company names itself (an internal assistant, an enterprise ChatGPT workspace). */
  links: GuidanceLink[];
}

export const DEFAULT_GUIDANCE: BlockGuidance = {
  message: 'Your company hasn’t approved this AI tool. Use one of the approved tools instead.',
  links: [],
};
export const MAX_GUIDANCE_LINKS = 5;

/** A tenant's choices for AI tools reached outside the gateway. */
export interface ShadowAiPolicy {
  /** What the extension does for tools without a decision: just record visits, or block them. */
  mode: 'monitor' | 'block';
  decisions: Record<string, ToolDecision>;
  guidance: BlockGuidance;
}

export const DEFAULT_SHADOW_POLICY: ShadowAiPolicy = { mode: 'monitor', decisions: {}, guidance: DEFAULT_GUIDANCE };

/** Stored on the tenant record so it moves with the tenant. */
export class ShadowAiPolicyStore {
  private tenants = () => collection('tenants');

  async get(tenantId: string): Promise<ShadowAiPolicy> {
    const tenant = await this.tenants().get({ tenantId });
    const stored = tenant?.shadowAi as Partial<ShadowAiPolicy> | undefined;
    // Decisions saved under a tool's earlier id count under its current one.
    const decisions: Record<string, ToolDecision> = {};
    for (const [id, d] of Object.entries(stored?.decisions ?? {})) decisions[canonicalToolId(id)] = d;
    return {
      mode: stored?.mode === 'block' ? 'block' : 'monitor',
      decisions,
      guidance: {
        message: stored?.guidance?.message || DEFAULT_GUIDANCE.message,
        links: [...(stored?.guidance?.links ?? [])],
      },
    };
  }

  async save(tenantId: string, policy: ShadowAiPolicy): Promise<void> {
    const saved = await this.tenants().update({ tenantId }, { set: { shadowAi: policy, updatedAt: new Date().toISOString() }, ifExists: true });
    if (!saved) throw Object.assign(new Error('Tenant not found'), { statusCode: 404, code: 'NOT_FOUND' });
  }
}

export interface PolicyChange {
  mode?: 'monitor' | 'block';
  decisions?: Record<string, ToolDecision | null>;
  guidance?: { message?: string; links?: GuidanceLink[] };
}

/** Only plain https links, so the block page can't be used to send people somewhere odd. */
function validLink(l: GuidanceLink): boolean {
  try {
    const u = new URL(l.url);
    return u.protocol === 'https:' && !u.username && !u.password && l.name.trim().length > 0;
  } catch {
    return false;
  }
}

/** Apply a change: a decision of null clears it (back to undecided). Unknown tool ids are rejected. */
export function applyPolicyChange(current: ShadowAiPolicy, change: PolicyChange): { policy: ShadowAiPolicy } | { error: string } {
  const decisions = { ...current.decisions };
  for (const [id, decision] of Object.entries(change.decisions ?? {})) {
    const tool = toolById(id);
    if (!tool) return { error: `Unknown tool: ${id}` };
    if (decision === null) delete decisions[tool.id];
    else decisions[tool.id] = decision;
  }
  let guidance = current.guidance;
  if (change.guidance) {
    const links = change.guidance.links ?? guidance.links;
    if (links.length > MAX_GUIDANCE_LINKS) return { error: `At most ${MAX_GUIDANCE_LINKS} links` };
    const bad = links.find((l) => !validLink(l));
    if (bad) return { error: `Links must be https addresses with a name: ${bad.url}` };
    guidance = {
      message: change.guidance.message?.trim() || (change.guidance.message === undefined ? guidance.message : DEFAULT_GUIDANCE.message),
      links: links.map((l) => ({ name: l.name.trim(), url: l.url })),
    };
  }
  return { policy: { mode: change.mode ?? current.mode, decisions, guidance } };
}

/** What the browser extension enforces, derived from the policy. */
export function extensionConfig(tenantId: string, policy: ShadowAiPolicy) {
  const domainsOf = (ids: string[]) => ids.flatMap((id) => toolById(id)?.domains ?? []);
  const decided = Object.keys(policy.decisions);
  const blocked = decided.filter((id) => policy.decisions[id] === 'blocked');
  const allowed = decided.filter((id) => policy.decisions[id] === 'allowed');
  const watched = [...new Set([...AI_TOOLS.flatMap((t) => t.domains), ...domainsOf(decided)])];
  return {
    tenantId,
    mode: policy.mode,
    // Domains the extension watches (name kept for older extension versions).
    blockedDomains: watched,
    // Always blocked, whatever the mode.
    enforcedDomains: domainsOf(blocked),
    // Never blocked or recorded.
    allowedDomains: domainsOf(allowed),
    // What the block page shows: the company's message, its own links, then approved tools from the list.
    blockPage: {
      message: policy.guidance.message,
      links: dedupe([
        ...policy.guidance.links,
        ...allowed.map(toolById).filter((t) => t?.url).map((t) => ({ name: t!.name, url: t!.url! })),
      ]),
    },
  };
}

function dedupe(links: GuidanceLink[]): GuidanceLink[] {
  const seen = new Set<string>();
  return links.filter((l) => !seen.has(l.url) && seen.add(l.url));
}
