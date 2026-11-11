import type { EvidenceListItem } from './evidence-api';

/** What a cleaned prompt had removed, in words. Older records say nothing, so they read as personal data. */
function removedWhat(removed: EvidenceListItem['removed']): string {
  if (removed?.secrets && removed.personalData) return 'secrets and personal data';
  if (removed?.secrets) return 'secrets';
  return 'personal data';
}

type Line = { verb: string; tone: 'stop' | 'ink' | 'muted'; text: string };
type DecisionFields = Pick<EvidenceListItem, 'outcome' | 'app' | 'model' | 'reason' | 'mcp' | 'unanswered' | 'removed' | 'flagged'>;

/** One line for a decision, the same on the Gateway and Evidence pages. */
export function describeDecision(i: DecisionFields): Line {
  if (!i.flagged) return baseLine(i);
  // A prompt that was sent but looked like an attack (Beta) says so, and stands out from the muted lines.
  if (i.outcome === 'delivered' && !i.unanswered) return { verb: 'Flagged', tone: 'ink', text: `a ${i.app} request to ${i.model} as a possible prompt attack; it was sent.` };
  const line = baseLine(i);
  return { ...line, tone: line.tone === 'muted' ? 'ink' : line.tone, text: `${line.text} Flagged as a possible prompt attack.` };
}

function baseLine(i: DecisionFields): Line {
  const target = i.mcp ? `${i.mcp.tool} on ${i.mcp.server}` : i.model;
  if (i.outcome === 'stopped') {
    return { verb: 'Stopped', tone: 'stop', text: i.mcp ? `a call to ${target}: ${i.reason ?? 'blocked by policy'}.` : `a ${i.app} request to ${target}: ${i.reason ?? 'blocked by policy'}.` };
  }
  if (i.mcp) {
    if (i.unanswered) return { verb: 'Not answered', tone: 'ink', text: `an agent called ${target}, but the API failed.` };
    return { verb: 'Called', tone: i.outcome === 'cleaned' ? 'ink' : 'muted', text: i.outcome === 'cleaned' ? `${target} for ${i.app}; personal data removed from the result.` : `${target} for ${i.app} with no findings.` };
  }
  if (i.unanswered) {
    return { verb: 'Not answered', tone: 'ink', text: i.outcome === 'cleaned' ? `a ${i.app} prompt was cleaned of ${removedWhat(i.removed)} and sent to ${target}, which refused or failed.` : `a ${i.app} request was sent to ${target}, which refused or failed.` };
  }
  if (i.outcome === 'cleaned') return { verb: 'Cleaned', tone: 'ink', text: `${removedWhat(i.removed)} from a ${i.app} prompt, then sent it to ${target}.` };
  return { verb: 'Delivered', tone: 'muted', text: `a ${i.app} request to ${target} with no findings.` };
}

export const TONE_CLASS = { stop: 'text-stop', ink: 'text-ink', muted: 'text-ink-muted' } as const;
