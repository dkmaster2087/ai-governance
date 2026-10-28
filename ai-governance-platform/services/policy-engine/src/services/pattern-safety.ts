import safeRegex from 'safe-regex2';

/** Longest tenant-supplied pattern we accept. */
export const MAX_PATTERN_LENGTH = 500;

const compiled = new Map<string, RegExp | null>();

/** Why a tenant-supplied regex can't be used, or null if it's fine. */
export function patternProblem(pattern: unknown): string | null {
  if (typeof pattern !== 'string' || pattern.length === 0) return 'Pattern must be a non-empty string';
  if (pattern.length > MAX_PATTERN_LENGTH) return `Pattern is longer than ${MAX_PATTERN_LENGTH} characters`;
  try {
    new RegExp(pattern, 'i');
  } catch (err) {
    return `Invalid regular expression: ${(err as Error).message}`;
  }
  // Nested quantifiers like (a+)+ can take exponential time on crafted input and stall the engine.
  if (!safeRegex(pattern)) return 'Pattern could be very slow on some inputs (nested repetition); simplify it';
  return null;
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
      problems.push(`Rule ${rule.ruleId ?? '?'}: patterns must be a list`);
      continue;
    }
    patterns.forEach((p, i) => {
      const problem = patternProblem(p);
      if (problem) problems.push(`Rule ${rule.ruleId ?? '?'}, pattern ${i + 1}: ${problem}`);
    });
  }
  return problems;
}
