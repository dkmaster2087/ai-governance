/**
 * Attacks hidden in an MCP tool call's arguments: values an agent (or a prompt that took it over) sends to make
 * the API behind the tool do something else. SQL injection, OS commands, path traversal, NoSQL operators and
 * requests to cloud metadata or local addresses.
 *
 * The real fix belongs in the API (parameterised queries, no shell, fixed paths). This is the layer in front:
 * strong patterns only, so ordinary text like "O'Brien" or "rock & roll" passes. Each string is checked as sent
 * and with URL-encoding undone once.
 */

export type ArgumentAttackKind = 'sql' | 'command' | 'path' | 'nosql' | 'ssrf';
export type ArgumentCheckMode = 'block' | 'flag' | 'off';

export interface ArgumentFinding {
  kind: ArgumentAttackKind;
  /** Where in the arguments, e.g. `arguments.body.name`. */
  path: string;
}

const PATTERNS: Array<[ArgumentAttackKind, RegExp]> = [
  // ' OR 1=1, ' or 'a'='a, " AND 2>1
  ['sql', /['"`]\s*\)?\s*(or|and|\|\||&&)\s+['"`(]?\s*[\w.]+\s*['"`]?\s*(=|<>|!=|<|>|\blike\b)\s*['"`(]?\s*[\w.]*/i],
  ['sql', /\bunion\b(\s+all)?\s*(\/\*.*?\*\/\s*)?\bselect\b/i],
  ['sql', /;\s*(drop|delete|truncate|alter|insert|update|create|grant|exec(ute)?|shutdown)\b\s+\w/i],
  // A quote closing the string, then a comment that cuts off the rest of the query.
  ['sql', /['"`]\s*\)?\s*(--|#|\/\*)/],
  ['sql', /\b(pg_)?sleep\s*\(\s*\d|\bbenchmark\s*\(\s*\d|\bwaitfor\s+delay\b/i],
  ['sql', /\bxp_cmdshell\b|\binformation_schema\b|\bload_file\s*\(|\binto\s+(out|dump)file\b|\bsys\.(objects|tables|columns)\b/i],
  // ; rm -rf, && curl, | sh, $(…), `…`
  ['command', /([;&|`]|\$\()\s*(rm\s+-|curl\s|wget\s|nc\s+-|ncat\s|bash\s+-|sh\s+-c|python[23]?\s+-c|perl\s+-e|chmod\s+[0-7+]|powershell\b|cmd(\.exe)?\s+\/c)/i],
  ['command', /\|\s*(sh|bash|zsh)\b|\$\(\s*[a-z_][\w.-]*(\s[^)]{0,200})?\)|`[^`]{0,200}\b(id|whoami|uname|cat|ls|curl|wget)\b[^`]{0,200}`/i],
  ['path', /(^|[\\/])\.\.[\\/]|\/etc\/(passwd|shadow|hosts)\b|\b[a-z]:\\windows\\(system32|win\.ini)/i],
  ['ssrf', /\b(https?|gopher|file|dict):\/\/(169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200|\[?fd00:ec2::254|localhost\b|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])/i],
  ['ssrf', /^file:\/\//i],
];

/** MongoDB-style operators as object keys: {"$ne": null} logs in as anyone. */
const NOSQL_KEY = /^\$(where|ne|gt|gte|lt|lte|regex|in|nin|or|and|not|nor|expr|function|accumulator|exists|elemMatch)$/;

function decoded(s: string): string | null {
  if (!/%[0-9a-f]{2}/i.test(s)) return null;
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return null; }
}

function checkString(s: string, path: string, out: ArgumentFinding[]) {
  const text = s.length > 20_000 ? s.slice(0, 20_000) : s;
  const variants = [text, decoded(text)].filter((v): v is string => !!v);
  for (const [kind, re] of PATTERNS) {
    if (out.some((f) => f.path === path && f.kind === kind)) continue;
    if (variants.some((v) => re.test(v))) out.push({ kind, path });
  }
}

function walk(v: unknown, path: string, out: ArgumentFinding[], depth: number) {
  if (depth > 20 || out.length >= 20) return;
  if (typeof v === 'string') return checkString(v, path, out);
  if (Array.isArray(v)) { v.slice(0, 500).forEach((x, i) => walk(x, `${path}[${i}]`, out, depth + 1)); return; }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (NOSQL_KEY.test(k)) out.push({ kind: 'nosql', path: `${path}.${k}` });
      checkString(k, `${path} (a key)`, out);
      walk(x, `${path}.${k}`, out, depth + 1);
    }
  }
}

/** What looks like an attack in these arguments; empty when nothing does. */
export function findArgumentAttacks(args: unknown): ArgumentFinding[] {
  const out: ArgumentFinding[] = [];
  walk(args, 'arguments', out, 0);
  return out;
}

export const ATTACK_LABEL: Record<ArgumentAttackKind, string> = {
  sql: 'SQL injection',
  command: 'an operating-system command',
  path: 'a path outside the expected folder',
  nosql: 'a database query operator',
  ssrf: 'a request to a local or cloud-metadata address',
};

/** "SQL injection in arguments.name" style summary, for the agent and the case file. */
export function describeFindings(findings: ArgumentFinding[]): string {
  return findings.slice(0, 3).map((f) => `${ATTACK_LABEL[f.kind]} in ${f.path}`).join('; ');
}
