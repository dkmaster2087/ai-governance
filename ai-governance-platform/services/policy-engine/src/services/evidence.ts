import { PolicyEvidence, PolicyRuleType } from '@ai-governance/types';
import { maskPII } from '@ai-governance/utils';

/** Where a rule matched: a span of the prompt text, or a request field such as the model. */
export type RuleMatch =
  | { kind: 'text'; index: number; length: number; label?: string }
  | { kind: 'field'; field: string; value: string };

const CONTEXT_CHARS = 60;

function clip(text: string, fromEnd: boolean): string {
  const flat = text.replace(/\s+/g, ' ');
  if (flat.length <= CONTEXT_CHARS) return flat;
  if (fromEnd) {
    const cut = flat.slice(flat.length - CONTEXT_CHARS);
    const space = cut.indexOf(' ');
    return '…' + (space > 0 && space < 20 ? cut.slice(space) : cut);
  }
  const cut = flat.slice(0, CONTEXT_CHARS);
  const space = cut.lastIndexOf(' ');
  return (space > CONTEXT_CHARS - 20 ? cut.slice(0, space) : cut) + '…';
}

/**
 * A short excerpt around the match, safe to keep as evidence: surrounding personal data is masked,
 * and a personal-data match is replaced by its label rather than stored.
 */
export function buildEvidence(ruleId: string, ruleType: PolicyRuleType, text: string, match: RuleMatch): PolicyEvidence {
  if (match.kind === 'field') {
    return { ruleId, ruleType, before: `${match.field}: `, hit: match.value, after: '' };
  }
  const before = maskPII(clip(text.slice(0, match.index), true), '[PII]');
  const after = maskPII(clip(text.slice(match.index + match.length), false), '[PII]');
  const raw = text.slice(match.index, match.index + match.length);
  const hit = match.label ? `[${match.label}]` : raw.replace(/\s+/g, ' ');
  return { ruleId, ruleType, before, hit, after };
}
