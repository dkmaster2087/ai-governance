import safeRegex from 'safe-regex2';

/** Longest tenant-supplied pattern we accept. */
export const MAX_PATTERN_LENGTH = 500;

const compiled = new Map<string, RegExp | null>();

/** Why a tenant-supplied regex can't be used, or null if it's fine. */
export function patternProblem(pattern: unknown): string | null {
  if (typeof pattern !== 'string' || pattern.length === 0) return 'is empty';
  if (pattern.length > MAX_PATTERN_LENGTH) return `is longer than ${MAX_PATTERN_LENGTH} characters`;
  try {
    new RegExp(pattern, 'i');
  } catch (err) {
    return `isn’t a valid pattern: ${plainRegexError((err as Error).message)}`;
  }
  // Nested quantifiers like (a+)+ can take exponential time on crafted input and stall the engine.
  if (!safeRegex(pattern)) return 'could be very slow on some inputs (repetition inside repetition); simplify it';
  return null;
}

/** JavaScript's regex errors in words an admin can act on. */
function plainRegexError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('unterminated character class')) return 'a [ has no closing ]';
  if (m.includes('unterminated group') || m.includes('missing )')) return 'a ( has no closing )';
  if (m.includes("unmatched ')'")) return 'a ) has no opening (';
  if (m.includes('nothing to repeat')) return '*, + or ? has nothing before it to repeat';
  if (m.includes('incomplete quantifier') || m.includes('numbers out of order')) return 'a {…} count is incomplete or out of order';
  if (m.includes('\\ at end of pattern')) return 'it ends with a lone \\';
  return 'check the brackets and special characters';
}

/** Compile a tenant pattern once, returning null for anything unsafe or invalid. */
export function compileTenantPattern(pattern: string): RegExp | null {
  if (compiled.has(pattern)) return compiled.get(pattern)!;
  const re = patternProblem(pattern) === null ? new RegExp(pattern, 'i') : null;
  compiled.set(pattern, re);
  return re;
}

/** Problems with the regex patterns in a policy's rules, as human-readable messages. */
export function validatePolicyPatterns(rules: unknown): string[] {
  if (!Array.isArray(rules)) return [];
  const problems: string[] = [];
  for (const rule of rules as Array<{ ruleId?: string; type?: string; config?: { patterns?: unknown } }>) {
    if (rule?.type !== 'data_classification') continue;
    const patterns = rule.config?.patterns;
    if (patterns === undefined) continue;
    if (!Array.isArray(patterns)) {
      problems.push('The patterns must be a list');
      continue;
    }
    patterns.forEach((p, i) => {
      const problem = patternProblem(p);
      if (problem) problems.push(`The pattern ${typeof p === 'string' && p ? `“${p.slice(0, 80)}”` : String(i + 1)} ${problem}.`);
    });
  }
  return problems;
}
