/**
 * Finds credentials in prompt text: cloud and SaaS API keys, tokens, private keys, connection strings
 * with passwords, and "password = ..." style assignments.
 *
 * Patterns are chosen for precision: each one matches a format that is almost never anything but a
 * credential, so stopping a request on a match is safe. Obvious placeholders (AKIA...EXAMPLE, xxxx,
 * <your-key>, ${VAR}) are ignored. The secret's value is never returned; callers get a type, a label
 * and its position, and use `redactSecrets` to produce text that is safe to send or store.
 */

export type SecretsAction = 'block' | 'redact' | 'off';

export interface SecretFinding {
  type: string;
  label: string;
  start: number;
  end: number;
}

interface Pattern {
  type: string;
  label: string;
  regex: RegExp;
  /** When set, only this capture group is the secret (the rest is context such as "password="). */
  group?: number;
}

const PATTERNS: Pattern[] = [
  { type: 'private_key', label: 'private key',
    // The whole block when it's complete; the header onwards when it was pasted cut off.
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----(?:[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----|[A-Za-z0-9+/=\s:,-]*)/g },
  { type: 'aws_access_key', label: 'AWS access key', regex: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g },
  { type: 'aws_secret_key', label: 'AWS secret key',
    regex: /\baws[\w.-]{0,20}?(?:secret|sk)[\w.-]{0,20}?["']?\s*[:=]\s*["']?([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+])/gi, group: 1 },
  // Pasted as a pair without a label ("key AKIA… secret wJal…"): a 40-character secret shortly after an access key ID.
  { type: 'aws_secret_key', label: 'AWS secret key',
    regex: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b[^\n]{1,80}?(?<![A-Za-z0-9/+])([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+])/g, group: 1 },
  { type: 'anthropic_key', label: 'Anthropic API key', regex: /\bsk-ant-[A-Za-z0-9_-]{32,}/g },
  { type: 'openai_key', label: 'OpenAI API key',
    regex: /\bsk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}|[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}|[A-Za-z0-9]{48})(?![A-Za-z0-9_-])/g },
  { type: 'github_token', label: 'GitHub token', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g },
  { type: 'gitlab_token', label: 'GitLab token', regex: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { type: 'slack_token', label: 'Slack token', regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { type: 'slack_webhook', label: 'Slack webhook URL', regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{16,}/g },
  { type: 'stripe_key', label: 'Stripe live key', regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { type: 'google_api_key', label: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g },
  { type: 'google_oauth_secret', label: 'Google OAuth client secret', regex: /\bGOCSPX-[A-Za-z0-9_-]{28}(?![A-Za-z0-9_-])/g },
  { type: 'azure_storage_key', label: 'Azure storage key', regex: /\bAccountKey=([A-Za-z0-9+/]{86}==)/g, group: 1 },
  { type: 'azure_shared_access_key', label: 'Azure shared access key', regex: /\bSharedAccessKey=([A-Za-z0-9+/]{42,43}=)/g, group: 1 },
  { type: 'huggingface_token', label: 'Hugging Face token', regex: /\bhf_[A-Za-z0-9]{34,}\b/g },
  { type: 'npm_token', label: 'npm token', regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { type: 'sendgrid_key', label: 'SendGrid API key', regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g },
  { type: 'twilio_key', label: 'Twilio API key', regex: /\bSK[0-9a-f]{32}\b/g },
  { type: 'shopify_token', label: 'Shopify token', regex: /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/g },
  { type: 'jwt', label: 'access token (JWT)', regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { type: 'connection_string', label: 'connection string with a password',
    regex: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|sqlserver):\/\/[^\s:/@]+:([^\s@/]{3,})@[^\s/]+/gi, group: 1 },
  { type: 'password', label: 'password or secret',
    regex: /\b(?:password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\b["']?\s*[:=]\s*["']?([^\s"',;]{8,200})/gi, group: 1 },
];

/** Values that are clearly stand-ins, not real credentials. */
const PLACEHOLDER = /EXAMPLE|example|x{6,}|X{6,}|\*{3,}|\.{3}|…|0{8,}|<[^>]*>|\$\{|\{\{|%\(|your[_-]?|dummy|placeholder|redacted|REDACTED|changeme|replace[_-]?me/i;

/** For the loose "password = ..." pattern: skip code references and plain words. */
function looksLikeValue(value: string): boolean {
  if (/^(?:true|false|null|none|undefined|required|optional|string|number)$/i.test(value)) return false;
  // An identifier or property path (config.password, getSecret(), process.env.API_KEY) is code, not a secret.
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/.test(value) && !/\d/.test(value)) return false;
  if (/^(?:process\.env|os\.environ|env\.|ENV\[|System\.getenv|secrets\.)/.test(value)) return false;
  return true;
}

/** Every credential in the text, in order, without overlaps. */
export function findSecrets(text: string): SecretFinding[] {
  if (!text) return [];
  const found: SecretFinding[] = [];
  for (const p of PATTERNS) {
    p.regex.lastIndex = 0;
    for (const m of text.matchAll(p.regex)) {
      const value = p.group ? m[p.group] : m[0];
      if (!value || PLACEHOLDER.test(value)) continue;
      if (p.type === 'password' && !looksLikeValue(value)) continue;
      const start = (m.index ?? 0) + (p.group ? m[0].lastIndexOf(value) : 0);
      found.push({ type: p.type, label: p.label, start, end: start + value.length });
    }
  }
  // Keep the earliest match at each place; on ties the longer one, so a key isn't also counted as a "password".
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: SecretFinding[] = [];
  for (const f of found) {
    const last = out[out.length - 1];
    if (last && f.start < last.end) continue;
    out.push(f);
  }
  return out;
}

export const redactionMarker = (f: Pick<SecretFinding, 'type'>) => `[REDACTED ${f.type}]`;

/** The text with every credential replaced by a marker naming its type. */
export function redactSecrets(text: string, findings = findSecrets(text)): string {
  let out = text;
  for (let i = findings.length - 1; i >= 0; i--) {
    const f = findings[i];
    out = out.slice(0, f.start) + redactionMarker(f) + out.slice(f.end);
  }
  return out;
}

export interface SecretScan {
  /** Distinct types found, in the order first seen. */
  types: string[];
  labels: string[];
  count: number;
  /** A short excerpt around the first finding with every secret replaced, safe to keep as evidence. */
  evidence?: { before: string; hit: string; after: string };
}

const CONTEXT = 40;

/** Scan several texts (a conversation's messages) and summarise what was found. */
export function scanTexts(texts: string[]): SecretScan {
  const types: string[] = [];
  const labels: string[] = [];
  let count = 0;
  let evidence: SecretScan['evidence'];
  for (const text of texts) {
    const findings = findSecrets(text);
    count += findings.length;
    for (const f of findings) {
      if (!types.includes(f.type)) { types.push(f.type); labels.push(f.label); }
    }
    if (!evidence && findings.length > 0) {
      // Findings never overlap, so every other one lies wholly before or after the first. Redact each side,
      // then keep the context nearest the hit.
      const f = findings[0];
      const after = findings.slice(1).map((o) => ({ ...o, start: o.start - f.end, end: o.end - f.end }));
      evidence = {
        before: text.slice(0, f.start).slice(-CONTEXT),
        hit: `[${f.label}]`,
        after: redactSecrets(text.slice(f.end), after).slice(0, CONTEXT),
      };
    }
  }
  return { types, labels, count, evidence };
}

/** "an AWS access key", "an AWS access key and a GitHub token", "3 kinds of secret". */
export function describeSecrets(labels: string[]): string {
  const a = (l: string) => (/^[aeiouAEIO]/.test(l) ? `an ${l}` : `a ${l}`);
  if (labels.length === 0) return 'a secret';
  if (labels.length === 1) return a(labels[0]);
  if (labels.length === 2) return `${a(labels[0])} and ${a(labels[1])}`;
  return `${labels.length} kinds of secret (${labels.slice(0, 2).join(', ')}, …)`;
}

/** Walk a provider request body and redact every string inside it. Used by proxy mode. */
export function redactDeep<T>(value: T): { value: T; changed: boolean } {
  let changed = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const findings = findSecrets(v);
      if (findings.length === 0) return v;
      changed = true;
      return redactSecrets(v, findings);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(value) as T;
  return { value: out, changed };
}
