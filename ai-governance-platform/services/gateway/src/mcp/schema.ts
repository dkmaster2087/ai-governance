import { JsonSchema } from './openapi';


/** String formats an API can ask for. Unknown formats are not enforced, as JSON Schema says. */
const FORMATS: Record<string, RegExp> = {
  email: /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@.]{2,63}$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^\d{4}-\d{2}-\d{2}$/,
  'date-time': /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i,
  time: /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i,
  ipv4: /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/,
  hostname: /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i,
  uri: /^[a-z][a-z0-9+.-]*:[^\s]*$/i,
};
const INT_RANGE: Record<string, [number, number]> = { int32: [-(2 ** 31), 2 ** 31 - 1], int64: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER] };

/** An API's own pattern, compiled once. Long or broken patterns are skipped rather than trusted. */
const patterns = new Map<string, RegExp | null>();
function compiled(source: string): RegExp | null {
  if (!patterns.has(source)) {
    let re: RegExp | null = null;
    if (source.length <= 500) { try { re = new RegExp(source, 'u'); } catch { re = null; } }
    if (patterns.size > 2000) patterns.clear();
    patterns.set(source, re);
  }
  return patterns.get(source) ?? null;
}

/**
 * Check tool arguments against the tool's input schema: the subset of JSON Schema OpenAPI descriptions use
 * (type, properties, required, additionalProperties, items, enum, string length and pattern, format, numeric
 * range). Returns the problems, in plain words; empty when the arguments are fine.
 */
export function validateArguments(schema: JsonSchema, value: unknown, path = 'arguments', depth = 0): string[] {
  if (depth > 20) return [];
  const s = schema as any;
  const errors: string[] = [];
  const types: string[] = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  if (types.length) {
    const t = typeOf(value);
    const ok = types.some((want) => want === t || (want === 'number' && t === 'integer'));
    if (!ok) return [`${path} should be ${types.join(' or ')}`];
  }
  if (Array.isArray(s.enum) && !s.enum.some((e: unknown) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path} should be one of ${s.enum.map((e: unknown) => JSON.stringify(e)).join(', ')}`);
  }
  if (typeof value === 'string') {
    if (typeof s.maxLength === 'number' && value.length > s.maxLength) errors.push(`${path} is longer than ${s.maxLength}`);
    if (typeof s.minLength === 'number' && value.length < s.minLength) errors.push(`${path} is shorter than ${s.minLength}`);
    // Patterns are tested on values up to 10,000 characters, so a slow pattern can't hold the gateway up for long.
    if (typeof s.pattern === 'string' && value.length <= 10_000) {
      const re = compiled(s.pattern);
      if (re && !re.test(value)) errors.push(`${path} isn't in the expected form`);
    } else if (typeof s.pattern === 'string') errors.push(`${path} is too long to check`);
    if (typeof s.format === 'string' && FORMATS[s.format] && !FORMATS[s.format].test(value)) errors.push(`${path} should be ${s.format === 'email' ? 'an email address' : `a ${s.format}`}`);
  }
  if (typeof value === 'number') {
    if (typeof s.maximum === 'number' && value > s.maximum) errors.push(`${path} is above ${s.maximum}`);
    if (typeof s.minimum === 'number' && value < s.minimum) errors.push(`${path} is below ${s.minimum}`);
    const range = typeof s.format === 'string' ? INT_RANGE[s.format] : undefined;
    if (range && (value < range[0] || value > range[1])) errors.push(`${path} is out of range for ${s.format}`);
  }
  if (Array.isArray(value) && s.items) {
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) errors.push(`${path} has more than ${s.maxItems} items`);
    value.slice(0, 200).forEach((v, i) => errors.push(...validateArguments(s.items, v, `${path}[${i}]`, depth + 1)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props: Record<string, JsonSchema> = s.properties ?? {};
    for (const r of s.required ?? []) if (obj[r] === undefined) errors.push(`${path}.${r} is required`);
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) errors.push(...validateArguments(props[k], v, `${path}.${k}`, depth + 1));
      else if (s.additionalProperties === false) errors.push(`${path}.${k} isn't an argument of this tool`);
    }
  }
  return errors;
}
