import type { EvidenceListItem } from './evidence-api';

/** One line for a decision, the same on the Gateway and Evidence pages. */
export function describeDecision(i: Pick<EvidenceListItem, 'outcome' | 'app' | 'model' | 'reason' | 'mcp' | 'unanswered'>): { verb: string; tone: 'stop' | 'ink' | 'muted'; text: string } {
  const target = i.mcp ? `${i.mcp.tool} on ${i.mcp.server}` : i.model;
  if (i.outcome === 'stopped') {
    return { verb: 'Stopped', tone: 'stop', text: i.mcp ? `a call to ${target}: ${i.reason ?? 'blocked by policy'}.` : `a ${i.app} request to ${target}: ${i.reason ?? 'blocked by policy'}.` };
  }
  if (i.mcp) {
    if (i.unanswered) return { verb: 'Not answered', tone: 'ink', text: `an agent called ${target}, but the API failed.` };
    return { verb: 'Called', tone: i.outcome === 'cleaned' ? 'ink' : 'muted', text: i.outcome === 'cleaned' ? `${target} for ${i.app}; personal data removed from the result.` : `${target} for ${i.app} with no findings.` };
  }
  if (i.unanswered) {
    return { verb: 'Not answered', tone: 'ink', text: i.outcome === 'cleaned' ? `a ${i.app} prompt was cleaned of personal data and sent to ${target}, which refused or failed.` : `a ${i.app} request was sent to ${target}, which refused or failed.` };
  }
  if (i.outcome === 'cleaned') return { verb: 'Cleaned', tone: 'ink', text: `personal data from a ${i.app} prompt, then sent it to ${target}.` };
  return { verb: 'Delivered', tone: 'muted', text: `a ${i.app} request to ${target} with no findings.` };
}

export const TONE_CLASS = { stop: 'text-stop', ink: 'text-ink', muted: 'text-ink-muted' } as const;
